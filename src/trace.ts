import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './util.js';
import type { AgentName, SessionPhase } from './session.js';

// ── Event types ──────────────────────────────────────────────────────

export interface SessionEvent {
  ts: string;
  seq: number;
  event: string;
  turn?: number;
  agent?: AgentName;
  phase?: SessionPhase;
  data?: Record<string, unknown>;
}

export type EventName =
  | 'session.start'
  | 'attempt.start'
  | 'attempt.end'
  | 'attempt.validation_failed'
  | 'turn.written'
  | 'turn.error'
  | 'phase.changed'
  | 'consensus.reached'
  | 'pr.created'
  | 'session.end';

// ── Attempt metadata ─────────────────────────────────────────────────

export interface AttemptMeta {
  turn: number;
  agent: AgentName;
  attempt_index: number;
  phase: SessionPhase;
  elapsed_ms: number;
  exit_code: number;
  timed_out: boolean;
  validation_errors?: string[];
  cmd: string;
  cwd: string;
}

// ── Tracer ───────────────────────────────────────────────────────────

export class Tracer {
  private readonly eventsPath: string;
  private readonly attemptsDir: string;
  private seq = 0;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(sessionDir: string) {
    this.eventsPath = join(sessionDir, 'events.jsonl');
    this.attemptsDir = join(sessionDir, 'artifacts', 'attempts');
  }

  /**
   * Append a structured event to events.jsonl.
   * Writes are serialized through a promise chain to guarantee ordering.
   */
  emit(
    event: EventName,
    opts: {
      turn?: number;
      agent?: AgentName;
      phase?: SessionPhase;
      data?: Record<string, unknown>;
    } = {},
  ): void {
    const entry: SessionEvent = {
      ts: new Date().toISOString(),
      seq: this.seq++,
      event,
      ...(opts.turn !== undefined && { turn: opts.turn }),
      ...(opts.agent && { agent: opts.agent }),
      ...(opts.phase && { phase: opts.phase }),
      ...(opts.data && { data: opts.data }),
    };
    const line = JSON.stringify(entry) + '\n';
    this.writeChain = this.writeChain
      .then(() => appendFile(this.eventsPath, line, 'utf8'))
      .catch(() => {}); // best-effort — don't crash the orchestrator
  }

  /**
   * Save a full attempt artifact (prompt, output, metadata).
   * Directory: artifacts/attempts/attempt-<turn>-<agent>-<index>/
   */
  async saveAttempt(
    turn: number,
    agent: AgentName,
    index: number,
    prompt: string,
    output: string,
    meta: AttemptMeta,
  ): Promise<string> {
    const dirName = `attempt-${String(turn).padStart(4, '0')}-${agent}-${index}`;
    const dir = join(this.attemptsDir, dirName);
    await mkdir(dir, { recursive: true });
    await Promise.all([
      atomicWrite(join(dir, 'prompt.md'), prompt),
      atomicWrite(join(dir, 'output.md'), output || '(empty)'),
      atomicWrite(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n'),
    ]);
    return dirName;
  }

  /**
   * Flush the serialized write chain. Call before process exit.
   */
  async flush(): Promise<void> {
    await this.writeChain;
  }
}

// ── Read helpers (for API endpoints) ─────────────────────────────────

/**
 * Read all events from events.jsonl, optionally filtered by `since` timestamp.
 */
export async function readEvents(sessionDir: string, since?: string): Promise<SessionEvent[]> {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw: string;
  try {
    raw = await readFile(eventsPath, 'utf8');
  } catch {
    return [];
  }
  const events: SessionEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const evt: SessionEvent = JSON.parse(line);
      if (since && evt.ts <= since) continue;
      events.push(evt);
    } catch {
      // skip malformed lines (e.g. partial write on crash)
    }
  }
  return events;
}

/**
 * List all attempt directories with their metadata.
 */
export async function listAttempts(sessionDir: string): Promise<Array<AttemptMeta & { dir: string }>> {
  const attemptsDir = join(sessionDir, 'artifacts', 'attempts');
  let entries: string[];
  try {
    entries = await readdir(attemptsDir);
  } catch {
    return [];
  }
  const attempts: Array<AttemptMeta & { dir: string }> = [];
  for (const entry of entries.filter(e => e.startsWith('attempt-')).sort()) {
    try {
      const metaRaw = await readFile(join(attemptsDir, entry, 'meta.json'), 'utf8');
      const meta: AttemptMeta = JSON.parse(metaRaw);
      attempts.push({ ...meta, dir: entry });
    } catch {
      // skip incomplete attempts
    }
  }
  return attempts;
}
