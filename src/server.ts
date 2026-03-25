import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir, stat, access } from 'node:fs/promises';
import { join, dirname, basename, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './validation.js';
import { update as updateSession, listTurnFiles, listSessions, findSessionDir } from './session.js';
import type { Session } from './session.js';
import { readEvents, listAttempts } from './trace.js';
import * as ui from './ui.js';

interface Controller {
  readonly isPaused: boolean;
  readonly endRequested: boolean;
  readonly thinking: { agent: string; since: string } | null;
  readonly phase: string;
  interject(content: string): void;
  requestEnd(): void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_CONTENT_LENGTH = 10_000;
const UI_DIST = resolve(__dirname, 'ui', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};
function getDefaultPort(): number {
  return process.env.CI || process.env.DEF_NO_OPEN ? 0 : 18541;
}
let httpServer: import('node:http').Server | null = null;
let sessionRef: Session | null = null;
let controllerRef: Controller | null = null;
let readOnlyMode = false;
let targetRepoRef: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimeoutMs = 5 * 60 * 1000; // 5 minutes default
let idleResolve: (() => void) | null = null;
let browserOpened = false;

/**
 * Listen on the preferred port, falling back to a random port if taken.
 */
function listenWithFallback(server: import('node:http').Server, preferredPort: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        // Port taken — fall back to random
        server.removeListener('error', onError);
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      } else {
        reject(err);
      }
    };
    server.on('error', onError);
    server.listen(preferredPort, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

/**
 * Open the browser once per process. Subsequent calls are no-ops.
 */
function openBrowserOnce(url: string): void {
  if (browserOpened || process.env.CI || process.env.DEF_NO_OPEN) return;
  browserOpened = true;
  const openCmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  import('node:child_process').then(({ exec }) => {
    exec(`${openCmd} ${url}`);
  }).catch(() => {});
}

/**
 * Start the HTTP server for the watcher UI.
 */
export async function start(session: Session, controller: Controller): Promise<void> {
  if (httpServer) {
    throw new Error('Server is already running');
  }

  sessionRef = session;
  controllerRef = controller;
  // Derive targetRepo from session dir: <repo>/.def/sessions/<uuid>/
  targetRepoRef = resolve(session.dir, '..', '..', '..');

  httpServer = createServer(handleRequest);

  const port = await listenWithFallback(httpServer, getDefaultPort());
  await updateSession(session.dir, { port });
  session.port = port;
  const url = `http://localhost:${port}`;
  ui.status('server.url', { url });
  openBrowserOnce(url);
}

/**
 * Start the server in read-only mode for viewing completed sessions.
 * POST endpoints return 403. Does not write port to session.json (read-only).
 */
export async function startReadOnly(session: Session): Promise<void> {
  if (httpServer) {
    throw new Error('Server is already running');
  }

  readOnlyMode = true;
  sessionRef = session;
  controllerRef = null;

  try {
    httpServer = createServer(handleRequest);

    const port = await listenWithFallback(httpServer, getDefaultPort());
    const url = `http://localhost:${port}`;
    ui.status('server.url', { url });
    openBrowserOnce(url);
  } catch (err) {
    readOnlyMode = false;
    httpServer = null;
    sessionRef = null;
    throw err;
  }
}

/**
 * Start the server in explorer mode — no owning session, multi-session browsing only.
 * POST endpoints return 404. Serves the UI for browsing all sessions. Idle timeout starts immediately.
 */
export async function startExplorer(targetRepo: string, opts?: { idleTimeout?: number; port?: number }): Promise<void> {
  if (httpServer) {
    throw new Error('Server is already running');
  }

  readOnlyMode = true;
  sessionRef = null;
  controllerRef = null;
  targetRepoRef = targetRepo;
  if (opts?.idleTimeout !== undefined) idleTimeoutMs = opts.idleTimeout * 1000;

  httpServer = createServer(handleRequest);

  const preferredPort = opts?.port ?? getDefaultPort();
  const port = await listenWithFallback(httpServer, preferredPort);
  const url = `http://localhost:${port}`;
  ui.status('server.url', { url });
  openBrowserOnce(url);

  // Start idle timer immediately in explorer mode
  resetIdleTimer();
}

/**
 * Signal that the owning session has completed.
 * Starts the idle timer so the server stays alive for browsing.
 * Returns a promise that resolves when the server shuts down due to idle timeout.
 */
export function beginIdleShutdown(): Promise<void> {
  return new Promise<void>((r) => {
    idleResolve = r;
    resetIdleTimer();
  });
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    stop();
    if (idleResolve) {
      idleResolve();
      idleResolve = null;
    }
  }, idleTimeoutMs);
}

/**
 * Stop the HTTP server.
 */
export function stop(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    readOnlyMode = false;
    targetRepoRef = null;
    browserOpened = false;
  }
  if (idleResolve) {
    idleResolve();
    idleResolve = null;
  }
}

function validateOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // No origin header (direct curl, etc.) — allow
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function validateHost(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return true;
  const hostname = host.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // DNS rebinding protection: validate Host header
  if (!validateHost(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  // CORS / Origin check
  if (!validateOrigin(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  // CORS headers for localhost
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url!, `http://${req.headers.host}`);

  // Reset idle timer on any request
  if (idleTimer) resetIdleTimer();

  try {
    // API routes first
    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      await handleGetSessions(res);
    } else if (url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/turns') && req.method === 'GET') {
      await handleGetSessionTurns(res, url.pathname);
    } else if (url.pathname === '/api/turns' && req.method === 'GET') {
      if (!sessionRef) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No owning session' }));
        return;
      }
      await handleGetTurns(res);
    } else if (url.pathname === '/api/events' && req.method === 'GET') {
      if (!sessionRef) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No owning session' }));
        return;
      }
      await handleGetEvents(res, url);
    } else if (url.pathname === '/api/attempts' && req.method === 'GET') {
      if (!sessionRef) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No owning session' }));
        return;
      }
      await handleGetAttempts(res);
    } else if (url.pathname === '/api/interject' && req.method === 'POST') {
      if (!controllerRef) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active session' }));
        return;
      }
      await handleInterject(req, res);
    } else if (url.pathname === '/api/end-session' && req.method === 'POST') {
      if (!controllerRef) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active session' }));
        return;
      }
      await handleEndSession(req, res);
    } else if (req.method === 'GET') {
      // Static file serving from Vite build output
      await serveStatic(req, res, url);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    console.error('[server] Internal error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = normalize(resolve(join(UI_DIST, pathname)));

  // Directory traversal protection
  if (!filePath.startsWith(UI_DIST)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  // Try to serve the exact file, fall back to index.html (SPA)
  let targetPath = filePath;
  let exists = false;
  try {
    const s = await stat(targetPath);
    exists = s.isFile();
  } catch {
    // File not found — SPA fallback
  }

  if (!exists) {
    targetPath = join(UI_DIST, 'index.html');
    try {
      await stat(targetPath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
  }

  const ext = extname(targetPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isHashed = pathname.startsWith('/assets/');
  const cacheControl = isHashed
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  const data = await readFile(targetPath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': data.byteLength,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(data);
}

async function handleGetTurns(res: ServerResponse): Promise<void> {
  const turnsDir = join(sessionRef!.dir, 'turns');
  const turnFiles = await listTurnFiles(turnsDir);

  const turns = await Promise.all(
    turnFiles.map(async (file) => {
      const raw = await readFile(join(turnsDir, file), 'utf8');
      const parsed = validate(raw);
      return {
        id: parsed.data?.id || file.replace('.md', ''),
        turn: parsed.data?.turn,
        from: parsed.data?.from,
        timestamp: parsed.data?.timestamp,
        status: parsed.data?.status,
        phase: parsed.data?.phase || 'plan',
        verdict: parsed.data?.verdict,
        duration_ms: parsed.data?.duration_ms,
        decisions: parsed.data?.decisions || [],
        content: parsed.content || raw,
        model_tier: parsed.data?.model_tier,
        model_name: parsed.data?.model_name,
      };
    })
  );

  // Read session.json — authoritative source for status and completion metadata
  const sessionPath = join(sessionRef!.dir, 'session.json');
  const metadata = await getSessionMetadata(sessionPath);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    turns,
    session_id: sessionRef!.id,
    session_status: metadata.sessionStatus,
    phase: metadata.phase ?? controllerRef?.phase ?? 'plan',
    topic: sessionRef!.topic,
    turn_count: turns.length,
    thinking: controllerRef?.thinking ?? null,
    branch_name: metadata.branchName,
    pr_url: metadata.prUrl,
    pr_number: metadata.prNumber,
    turns_path: join(sessionRef!.dir, 'turns'),
    artifacts_path: join(sessionRef!.dir, 'artifacts'),
    artifact_names: metadata.artifactNames,
  }));
}

async function handleGetEvents(res: ServerResponse, url: URL): Promise<void> {
  const since = url.searchParams.get('since') ?? undefined;
  const events = await readEvents(sessionRef!.dir, since);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(events));
}

async function handleGetAttempts(res: ServerResponse): Promise<void> {
  const attempts = await listAttempts(sessionRef!.dir);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(attempts));
}

interface SessionMetadata {
  sessionStatus: string;
  phase: string | null;
  topic: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  artifactNames: string[];
}

export async function getSessionMetadata(sessionPath: string): Promise<SessionMetadata> {
  let sessionStatus = 'active';
  let phase: string | null = null;
  let topic: string | null = null;
  let branchName: string | null = null;
  let prUrl: string | null = null;
  let prNumber: number | null = null;

  try {
    const sessionData = JSON.parse(await readFile(sessionPath, 'utf8'));
    sessionStatus = sessionData.session_status ?? 'active';
    phase = sessionData.phase ?? null;
    topic = sessionData.topic ?? null;
    branchName = sessionData.branch_name ?? null;
    prUrl = sessionData.pr_url ?? null;
    prNumber = sessionData.pr_number ?? null;
  } catch {
    // Fall back to defaults
  }

  // Read artifact filenames from the artifacts directory next to session.json
  let artifactNames: string[] = [];
  try {
    const artifactsPath = join(dirname(sessionPath), 'artifacts');
    const entries = await readdir(artifactsPath);
    artifactNames = entries.filter(e => !e.startsWith('.'));
  } catch {
    // No artifacts directory — fine
  }

  return { sessionStatus, phase, topic, branchName, prUrl, prNumber, artifactNames };
}

async function handleGetSessions(res: ServerResponse): Promise<void> {
  if (!targetRepoRef) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No target repo configured' }));
    return;
  }

  const allSessions = await listSessions(targetRepoRef);
  const repoName = basename(targetRepoRef);

  // In normal mode, only show active/paused sessions (plus the owning session).
  // In explorer mode (no owning session), show all sessions.
  const isExplorerMode = sessionRef === null;
  const filtered = isExplorerMode
    ? allSessions
    : allSessions.filter(s =>
        s.session_status === 'active' || s.session_status === 'paused' || s.id === sessionRef?.id
      );
  const sessionsWithRepo = filtered.map(s => ({ ...s, repo: repoName }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    sessions: sessionsWithRepo,
    owning_session_id: sessionRef?.id ?? null,
  }));
}

async function handleGetSessionTurns(res: ServerResponse, pathname: string): Promise<void> {
  // Extract session ID from /api/sessions/:id/turns
  const parts = pathname.split('/');
  // ['', 'api', 'sessions', ':id', 'turns']
  const sessionId = parts[3];

  if (!sessionId || !targetRepoRef) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  // Find the session directory
  const sessionDir = await findSessionDir(targetRepoRef, sessionId);
  if (!sessionDir) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  // Read turns
  const turnsDir = join(sessionDir, 'turns');
  const turnFiles = await listTurnFiles(turnsDir);
  const turns = await Promise.all(
    turnFiles.map(async (file) => {
      const raw = await readFile(join(turnsDir, file), 'utf8');
      const parsed = validate(raw);
      return {
        id: parsed.data?.id || file.replace('.md', ''),
        turn: parsed.data?.turn,
        from: parsed.data?.from,
        timestamp: parsed.data?.timestamp,
        status: parsed.data?.status,
        phase: parsed.data?.phase || 'plan',
        verdict: parsed.data?.verdict,
        duration_ms: parsed.data?.duration_ms,
        decisions: parsed.data?.decisions || [],
        content: parsed.content || raw,
        model_tier: parsed.data?.model_tier,
        model_name: parsed.data?.model_name,
      };
    })
  );

  // Read session metadata
  const sessionPath = join(sessionDir, 'session.json');
  const metadata = await getSessionMetadata(sessionPath);

  // For the owning session, include live thinking state
  const isOwning = sessionRef?.id === sessionId;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    turns,
    session_id: sessionId,
    session_status: metadata.sessionStatus,
    phase: metadata.phase ?? (isOwning ? controllerRef?.phase : null) ?? 'plan',
    topic: metadata.topic ?? '(no topic)',
    turn_count: turns.length,
    thinking: isOwning ? (controllerRef?.thinking ?? null) : null,
    branch_name: metadata.branchName,
    pr_url: metadata.prUrl,
    pr_number: metadata.prNumber,
    turns_path: join(sessionDir, 'turns'),
    artifacts_path: join(sessionDir, 'artifacts'),
    artifact_names: metadata.artifactNames,
  }));
}

async function handleInterject(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Require JSON content type (CSRF defense-in-depth)
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Request body too large' }));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  // Defense-in-depth: if session_id is provided, verify it matches the owning session
  if (parsed.session_id && sessionRef && parsed.session_id !== sessionRef.id) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session ID mismatch' }));
    return;
  }

  const content = parsed.content;
  if (!content || typeof content !== 'string' || !content.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Content is required' }));
    return;
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Content exceeds ${MAX_CONTENT_LENGTH} character limit` }));
    return;
  }

  controllerRef!.interject(content);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

async function handleEndSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const contentType = req.headers['content-type'];
  if (contentType && !contentType.includes('application/json')) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
    return;
  }
  controllerRef!.requestEnd();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > MAX_CONTENT_LENGTH + 1000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
