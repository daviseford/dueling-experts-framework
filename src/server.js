import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './validation.js';
import { update as updateSession } from './session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_CONTENT_LENGTH = 10_000;
let httpServer = null;
let sessionRef = null;
let controllerRef = null;

/**
 * Start the HTTP server for the watcher UI.
 */
export async function start(session, controller) {
  sessionRef = session;
  controllerRef = controller;

  httpServer = createServer(handleRequest);

  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', async () => {
      const { port } = httpServer.address();
      await updateSession(session.dir, { port });
      session.port = port;
      console.log(`Watcher UI: http://localhost:${port}`);
      resolve();
    });
  });
}

/**
 * Stop the HTTP server.
 */
export function stop() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

function validateOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // No origin header (direct curl, etc.) — allow
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

async function handleRequest(req, res) {
  // CORS / Origin check
  if (!validateOrigin(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: non-localhost origin' }));
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

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/' && req.method === 'GET') {
      await serveUI(res);
    } else if (url.pathname === '/api/turns' && req.method === 'GET') {
      await handleGetTurns(res);
    } else if (url.pathname === '/api/interject' && req.method === 'POST') {
      await handleInterject(req, res);
    } else if (url.pathname === '/api/end-session' && req.method === 'POST') {
      await handleEndSession(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function serveUI(res) {
  const htmlPath = join(__dirname, 'ui', 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleGetTurns(res) {
  const turnsDir = join(sessionRef.dir, 'turns');
  let turnFiles = [];
  try {
    turnFiles = await readdir(turnsDir);
  } catch {
    // No turns yet
  }
  turnFiles = turnFiles
    .filter((f) => f.startsWith('turn-') && f.endsWith('.md') && !f.endsWith('.tmp'))
    .sort();

  const turns = [];
  for (const file of turnFiles) {
    const raw = await readFile(join(turnsDir, file), 'utf8');
    const parsed = validate(raw);
    turns.push({
      id: parsed.data?.id || file.replace('.md', ''),
      turn: parsed.data?.turn,
      from: parsed.data?.from,
      timestamp: parsed.data?.timestamp,
      status: parsed.data?.status,
      decisions: parsed.data?.decisions || [],
      content: parsed.content || raw,
    });
  }

  // Read current session status from session.json
  const sessionPath = join(sessionRef.dir, 'session.json');
  let sessionStatus = 'active';
  try {
    const sessionData = JSON.parse(await readFile(sessionPath, 'utf8'));
    sessionStatus = sessionData.session_status;
  } catch {
    // Fall back to active
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    turns,
    session_status: sessionStatus,
    topic: sessionRef.topic,
    turn_count: turns.length,
  }));
}

async function handleInterject(req, res) {
  const body = await readBody(req);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
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

  controllerRef.interject(content);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

async function handleEndSession(res) {
  controllerRef.requestEnd();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > MAX_CONTENT_LENGTH + 1000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
