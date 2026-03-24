import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validate } from './validation.js';
import type { TurnData, TurnStatus } from './validation.js';
import { invoke } from './agent.js';
import { update as updateSession, listTurnFiles } from './session.js';
import type { Session, AgentName, SessionPhase } from './session.js';
import { atomicWrite } from './util.js';
import { parseActions, executeActions } from './actions.js';
import type { ActionResult } from './actions.js';

// ── Type definitions ────────────────────────────────────────────────

interface InvokeOnceResult {
  ok: boolean;
  output: string;
  rawOutput: string;
  reason: string;
}

export interface Controller {
  readonly isPaused: boolean;
  readonly endRequested: boolean;
  readonly thinking: { agent: AgentName; since: string } | null;
  readonly phase: string;
  interject(content: string): void;
  requestEnd(): void;
}

export interface ServerModule {
  start(session: Session, controller: Controller): Promise<void>;
  stop(): void;
}

interface Ticker {
  interval: ReturnType<typeof setInterval>;
}

interface RunOptions {
  server?: ServerModule | null;
}

interface RecoveredState {
  pendingDecided: AgentName | null;
  reviewTurnCount: number;
}

interface CanonicalTurnData {
  id: string;
  turn: number;
  from: string;
  timestamp: string;
  status: string;
  phase: string;
  duration_ms?: number;
  decisions?: string[];
}

interface DecisionEntry {
  turn: number;
  from: string;
  decision: string;
}

// ── Main orchestrator ───────────────────────────────────────────────

/**
 * Run the orchestrator turn loop.
 * When a server is provided, supports interjection queue, pause/resume, and end-session.
 */
export async function run(session: Session, { server }: RunOptions = {}): Promise<void> {
  // Initialize child process tracking for SIGINT cleanup
  session._currentChild = null;

  let turnCount: number = session.current_turn;
  let nextAgent: AgentName = session.next_agent;
  let endRequested = false;

  // Phase tracking
  let phase: SessionPhase = session.phase || 'debate';

  // Consensus tracking for debate phase — derive from turn history on recovery
  let pendingDecided: AgentName | null = null;

  // Review turn counter — derive from turn history on recovery
  let reviewTurnCount = 0;

  // On recovery, reconstruct ephemeral state from turn history
  if (session.current_turn > 0) {
    const recovered: RecoveredState = await recoverEphemeralState(session);
    pendingDecided = recovered.pendingDecided;
    reviewTurnCount = recovered.reviewTurnCount;
  }

  // Interjection queue and pause state (active when server is present)
  const interjectionQueue: string[] = [];
  let isPaused = false;
  let humanResponseResolve: ((content: string) => void) | null = null;

  let thinkingAgent: AgentName | null = null;
  let thinkingSince: string | null = null;

  const controller: Controller = {
    get isPaused() { return isPaused; },
    get endRequested() { return endRequested; },
    get thinking() { return thinkingAgent ? { agent: thinkingAgent, since: thinkingSince! } : null; },
    get phase() { return phase; },
    interject(content: string): void {
      if (isPaused && humanResponseResolve) {
        humanResponseResolve(content);
        humanResponseResolve = null;
      } else {
        interjectionQueue.push(content);
      }
    },
    requestEnd(): void {
      endRequested = true;
    },
  };

  if (server) {
    await server.start(session, controller);
  }

  while (turnCount < session.max_turns && !endRequested) {
    turnCount++;

    // In implement phase, only the impl_model agent takes turns
    if (phase === 'implement') {
      nextAgent = session.impl_model;
    }
    // In review phase, only the non-impl agent takes turns
    if (phase === 'review') {
      const implModel: AgentName = session.impl_model;
      nextAgent = implModel === 'claude' ? 'codex' : 'claude';
    }

    // Invoke agent with one retry on failure
    thinkingAgent = nextAgent;
    thinkingSince = new Date().toISOString();
    const invokeStart: number = Date.now();
    let result: InvokeOnceResult = await invokeWithRetry(nextAgent, session, turnCount);
    const durationMs: number = Date.now() - invokeStart;
    thinkingAgent = null;
    thinkingSince = null;

    if (!result.ok) {
      await writeErrorTurn(session, turnCount, nextAgent, result.reason, result.rawOutput);
      const resumed: boolean = await pauseOrExit(turnCount, server ?? null);
      if (resumed) continue;
      break;
    }

    // Validate with one retry on failure
    let validation = validate(result.output, nextAgent);
    if (!validation.valid) {
      console.log(`[Turn ${turnCount}] Invalid output: ${validation.errors.join(', ')}. Retrying...`);
      result = await invokeOnce(nextAgent, session);
      validation = result.ok ? validate(result.output, nextAgent) : { valid: false, errors: ['retry failed'], data: null, content: '' };

      if (!validation.valid) {
        await writeErrorTurn(session, turnCount, nextAgent,
          `invalid frontmatter: ${validation.errors.join(', ')}`, result.rawOutput || result.output);
        const resumed: boolean = await pauseOrExit(turnCount, server ?? null);
        if (resumed) continue;
        break;
      }
    }

    // At this point validation.valid === true, so data is non-null
    const validData: TurnData = validation.data!;

    // Orchestrator assigns canonical turn number, id, filename
    const canonicalId = `turn-${String(turnCount).padStart(4, '0')}-${nextAgent}`;
    const normalizedStatus: string = normalizeStatus(validData.status, turnCount, phase);
    const canonicalData: CanonicalTurnData = {
      id: canonicalId,
      turn: turnCount,
      from: nextAgent,
      timestamp: new Date().toISOString(),
      status: normalizedStatus,
      phase,
      duration_ms: durationMs,
    };
    if (validData.decisions) {
      canonicalData.decisions = validData.decisions;
    }

    if (normalizedStatus !== validData.status) {
      console.log(`[Turn ${turnCount}] Agent signaled ${validData.status} too early — downgrading to complete.`);
    }

    await writeCanonicalTurn(session, canonicalId, canonicalData, validation.content);
    await savePromptForTurn(session, canonicalId);
    console.log(`[Turn ${turnCount}] [${phase}] Written: ${canonicalId} (status: ${canonicalData.status})`);

    const oppositeAgent: AgentName = nextAgent === 'claude' ? 'codex' : 'claude';

    // === Phase-specific post-turn logic ===

    if (phase === 'debate') {
      await updateSession(session.dir, {
        current_turn: turnCount,
        next_agent: oppositeAgent,
      });

      // Check for consensus signaling — treat 'done' as 'decided' in edit mode
      const effectiveStatus = (canonicalData.status === 'done' || canonicalData.status === 'decided')
        ? 'decided' : canonicalData.status;

      if (effectiveStatus === 'decided') {
        if (pendingDecided && pendingDecided !== nextAgent) {
          // Both agents agreed — transition to implement
          console.log(`[Turn ${turnCount}] Consensus reached. Transitioning to implement phase.`);
          phase = 'implement';
          pendingDecided = null;
          nextAgent = session.impl_model;
          await updateSession(session.dir, {
            phase: 'implement',
            next_agent: nextAgent,
          });
          continue;
        } else {
          // First decided — record and let the other agent respond
          pendingDecided = nextAgent;
          console.log(`[Turn ${turnCount}] ${nextAgent} signals decided. Waiting for ${oppositeAgent} to confirm.`);
          nextAgent = oppositeAgent;
        }
      } else {
        // If there was a pending decided and this agent didn't confirm, clear it
        if (pendingDecided && effectiveStatus === 'complete') {
          console.log(`[Turn ${turnCount}] ${nextAgent} contests consensus. Resuming debate.`);
          pendingDecided = null;
        }

        if (effectiveStatus === 'needs_human') {
          if (server) {
            isPaused = true;
            await updateSession(session.dir, { session_status: 'paused' });
            console.log(`[Turn ${turnCount}] Agent needs human input. Paused.`);

            const humanContent: string = await waitForHuman();
            isPaused = false;
            turnCount++;
            await writeHumanTurn(session, turnCount, humanContent);
            await updateSession(session.dir, {
              current_turn: turnCount,
              session_status: 'active',
              next_agent: nextAgent, // Same agent resumes
            });
            continue;
          }

          console.log(`[Turn ${turnCount}] Agent needs human input. Exiting (no UI).`);
          break;
        }

        nextAgent = oppositeAgent;
      }
    } else if (phase === 'implement') {
      // Parse and execute actions from the turn content
      const actions = parseActions(validation.content);
      if (actions.length > 0) {
        console.log(`[Turn ${turnCount}] Executing ${actions.length} action(s)...`);
        const results: ActionResult[] = await executeActions(actions, session.target_repo);

        const succeeded: number = results.filter(r => r.ok).length;
        const failed: number = results.filter(r => !r.ok).length;
        console.log(`[Turn ${turnCount}] Actions: ${succeeded} succeeded, ${failed} failed.`);

        // Store action results for review
        await writeActionResults(session, turnCount, results);

        // Transition to review
        console.log(`[Turn ${turnCount}] Implementation turn complete. Transitioning to review phase.`);
        phase = 'review';
        reviewTurnCount = 0;
        const reviewer: AgentName = session.impl_model === 'claude' ? 'codex' : 'claude';
        nextAgent = reviewer;
        await updateSession(session.dir, {
          current_turn: turnCount,
          phase: 'review',
          next_agent: reviewer,
        });
      } else {
        // No actions produced — send the agent back to try again
        console.log(`[Turn ${turnCount}] No def-action blocks found. Retrying implementation...`);
        await updateSession(session.dir, { current_turn: turnCount });
      }
    } else if (phase === 'review') {
      reviewTurnCount++;

      if (canonicalData.status === 'done') {
        console.log(`[Turn ${turnCount}] Reviewer approved. Session complete.`);
        break;
      }

      // Reviewer requested fixes
      if (reviewTurnCount >= session.review_turns) {
        console.log(`[Turn ${turnCount}] Review turn limit (${session.review_turns}) reached. Ending session.`);
        break;
      }

      // Switch back to implement for fixes
      console.log(`[Turn ${turnCount}] Reviewer requested fixes. Back to implement phase. (${reviewTurnCount}/${session.review_turns})`);
      phase = 'implement';
      nextAgent = session.impl_model;
      await updateSession(session.dir, {
        current_turn: turnCount,
        phase: 'implement',
        next_agent: nextAgent,
      });
    }

    // Drain interjection queue (one item per turn boundary, debate phase only)
    if (phase === 'debate' && interjectionQueue.length > 0) {
      const content: string = interjectionQueue.shift()!;
      turnCount++;
      await writeHumanTurn(session, turnCount, content);
      await updateSession(session.dir, {
        current_turn: turnCount,
        next_agent: oppositeAgent,
      });
      console.log(`[Turn ${turnCount}] Injected human interjection.`);
    }

    // Warn about dropped interjections on phase transitions
    if (phase !== 'debate' && interjectionQueue.length > 0) {
      console.log(`[Turn ${turnCount}] Warning: ${interjectionQueue.length} queued interjection(s) dropped (not in debate phase).`);
      interjectionQueue.length = 0;
    }
  }

  // Generate artifacts
  await generateDecisions(session);
  await updateSession(session.dir, { session_status: 'completed', phase });
  console.log('');
  console.log('Session completed.');
  console.log(`  Phase:     ${phase}`);
  console.log(`  Turns:     ${join(session.dir, 'turns')}`);
  console.log(`  Artifacts: ${join(session.dir, 'artifacts')}`);

  // --- Helper closures ---

  function waitForHuman(): Promise<string> {
    return new Promise<string>((resolve) => {
      humanResponseResolve = resolve;
    });
  }

  async function pauseOrExit(turn: number, srv: ServerModule | null): Promise<boolean> {
    await updateSession(session.dir, {
      current_turn: turn,
      session_status: srv ? 'paused' : 'completed',
    });

    if (srv) {
      isPaused = true;
      console.log(`[Turn ${turn}] Paused after error. Waiting for human...`);
      const humanContent: string = await waitForHuman();
      isPaused = false;
      turnCount++;
      await writeHumanTurn(session, turnCount, humanContent);
      await updateSession(session.dir, {
        current_turn: turnCount,
        session_status: 'active',
      });
      return true; // resumed
    }

    console.log(`[Turn ${turn}] Exiting after error.`);
    return false;
  }
}

// --- Recovery helpers ---

/**
 * Reconstruct ephemeral state from turn history on session recovery.
 * Returns { pendingDecided, reviewTurnCount }.
 */
async function recoverEphemeralState(session: Session): Promise<RecoveredState> {
  const turnsDir: string = join(session.dir, 'turns');
  const turnFiles: string[] = await listTurnFiles(turnsDir);

  let pendingDecided: AgentName | null = null;
  let reviewTurnCount = 0;
  let inReviewPhase = false;

  for (const file of turnFiles) {
    const raw: string = await readFile(join(turnsDir, file), 'utf8');
    const parsed = validate(raw);
    if (!parsed.valid || !parsed.data) continue;

    const { status, from } = parsed.data;

    // Track consensus state: if the last decided was uncontested, it's still pending
    if (status === 'decided') {
      if (pendingDecided && pendingDecided !== from) {
        // Both agents agreed — consensus was reached, implementation follows
        pendingDecided = null;
        inReviewPhase = true;
      } else {
        pendingDecided = from as AgentName;
      }
    } else if (status === 'complete' && pendingDecided) {
      // Contested — clear pending
      pendingDecided = null;
    }

    // Count review-phase turns (turns after the phase transitioned to review)
    if (session.phase === 'review' || session.phase === 'implement') {
      // If we see a turn from the non-impl agent after consensus, it's a review turn
      const reviewer: AgentName = session.impl_model === 'claude' ? 'codex' : 'claude';
      if (from === reviewer && inReviewPhase) {
        reviewTurnCount++;
      }
    }
  }

  return { pendingDecided, reviewTurnCount };
}

// --- Status normalization ---

/**
 * Normalize agent-claimed status to orchestrator canonical status.
 * Prevents premature "done" when the session hasn't had enough turns.
 */
export function normalizeStatus(agentStatus: TurnStatus | string, turnCount: number, phase: string = 'debate'): string {
  // In implement phase, agents should only emit 'complete' — downgrade everything else
  if (phase === 'implement') {
    if (agentStatus === 'needs_human') return 'needs_human';
    return 'complete';
  }
  if (agentStatus === 'done' && turnCount < 2) return 'complete';
  if (agentStatus === 'done') return 'done';
  if (agentStatus === 'decided' && turnCount < 2) return 'complete';
  if (agentStatus === 'decided') return 'decided';
  if (agentStatus === 'needs_human') return 'needs_human';
  return 'complete';
}

// --- Agent invocation helpers ---

async function invokeOnce(agentName: AgentName, session: Session): Promise<InvokeOnceResult> {
  const result = await invoke(agentName, { ...session, next_agent: agentName });
  const failed: boolean = result.timedOut || result.exitCode !== 0 || !result.output.trim();
  const reason: string = result.timedOut
    ? `timeout (${session.phase === 'implement' ? '600s' : '180s'})`
    : result.exitCode !== 0
      ? `exit code ${result.exitCode}`
      : 'empty output';
  return { ok: !failed, output: result.output, rawOutput: result.output, reason };
}

async function invokeWithRetry(agentName: AgentName, session: Session, turnCount: number): Promise<InvokeOnceResult> {
  let ticker: Ticker | null = startTicker(turnCount, agentName);
  let result: InvokeOnceResult = await invokeOnce(agentName, session);
  stopTicker(ticker);
  if (!result.ok) {
    console.log(`[Turn ${turnCount}] ${agentName} failed: ${result.reason}. Retrying...`);
    ticker = startTicker(turnCount, agentName, 'retry');
    result = await invokeOnce(agentName, session);
    stopTicker(ticker);
  }
  return result;
}

// --- Turn file helpers ---

async function writeCanonicalTurn(session: Session, id: string, data: CanonicalTurnData, content: string): Promise<void> {
  const filename = `${id}.md`;
  const turnsDir: string = join(session.dir, 'turns');
  await mkdir(turnsDir, { recursive: true }); // ensure dir exists (agents may interfere)
  const finalPath: string = join(turnsDir, filename);

  // Build frontmatter manually — do NOT use matter.stringify because it re-parses
  // the content body, allowing agents to inject frontmatter via embedded --- blocks.
  const frontmatter: string = '---\n' + yaml.dump(data, { lineWidth: -1 }).trim() + '\n---\n';
  await atomicWrite(finalPath, frontmatter + content + '\n');
}

async function savePromptForTurn(session: Session, canonicalId: string): Promise<void> {
  const promptPath: string = join(session.dir, 'runtime', 'prompt.md');
  const turnsDir: string = join(session.dir, 'turns');
  try {
    const prompt: string = await readFile(promptPath, 'utf8');
    await writeFile(join(turnsDir, `prompt-${canonicalId.replace('turn-', '')}.md`), prompt, 'utf8');
  } catch {
    // prompt.md may not exist (e.g., error recovery) — skip silently
  }
}

async function writeErrorTurn(session: Session, turnCount: number, agent: AgentName, reason: string, rawOutput: string): Promise<void> {
  const id = `turn-${String(turnCount).padStart(4, '0')}-${agent}`;
  const data: CanonicalTurnData = {
    id,
    turn: turnCount,
    from: agent,
    timestamp: new Date().toISOString(),
    status: 'error',
  };
  const body = `## Error\n\n**Reason:** ${reason}\n\n### Raw Output\n\n\`\`\`\n${rawOutput || '(empty)'}\n\`\`\``;
  await writeCanonicalTurn(session, id, data, body);
  console.log(`[Turn ${turnCount}] Error turn written: ${id}`);
}

async function writeHumanTurn(session: Session, turnCount: number, content: string): Promise<void> {
  const id = `turn-${String(turnCount).padStart(4, '0')}-human`;
  const data: CanonicalTurnData = {
    id,
    turn: turnCount,
    from: 'human',
    timestamp: new Date().toISOString(),
    status: 'complete',
  };
  await writeCanonicalTurn(session, id, data, content);
}

async function writeActionResults(session: Session, turnCount: number, results: ActionResult[]): Promise<void> {
  const artifactsDir: string = join(session.dir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const filename = `action-results-${String(turnCount).padStart(4, '0')}.json`;
  const serializable = results.map(r => ({
    type: r.action.type,
    path: r.action.path || null,
    cmd: r.action.cmd || null,
    ok: r.ok,
    error: r.error || null,
    output: r.output ? r.output.slice(0, 2000) : null,
  }));
  await atomicWrite(join(artifactsDir, filename), JSON.stringify(serializable, null, 2) + '\n');
}

async function generateDecisions(session: Session): Promise<void> {
  const turnsDir: string = join(session.dir, 'turns');
  const turnFiles: string[] = await listTurnFiles(turnsDir);
  if (turnFiles.length === 0) return;

  const decisions: DecisionEntry[] = [];
  for (const file of turnFiles) {
    const raw: string = await readFile(join(turnsDir, file), 'utf8');
    const parsed = validate(raw);
    if (parsed.valid && parsed.data?.decisions) {
      for (const d of parsed.data.decisions) {
        decisions.push({ turn: parsed.data.turn, from: parsed.data.from, decision: d });
      }
    }
  }

  if (decisions.length === 0) {
    console.log('No decisions found in turn frontmatter. Skipping decisions.md.');
    return;
  }

  const lines: string[] = ['# Decisions Log', ''];
  for (const { turn, from, decision } of decisions) {
    lines.push(`${turn}. **[${from}]** ${decision}`);
  }
  lines.push('');

  const artifactsDir: string = join(session.dir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const decisionsPath: string = join(artifactsDir, 'decisions.md');
  await atomicWrite(decisionsPath, lines.join('\n'));
  console.log(`Decisions log written: ${decisionsPath} (${decisions.length} decision(s))`);
}

// --- CLI progress ticker ---

function startTicker(turnCount: number, agent: string, label?: string): Ticker | null {
  const start: number = Date.now();
  const isTTY: boolean | undefined = process.stderr.isTTY;
  const prefix: string = label
    ? `[Turn ${turnCount}] ${label}: ${agent}`
    : `[Turn ${turnCount}] Invoking ${agent}`;

  if (!isTTY) {
    console.log(`${prefix}...`);
    return null;
  }

  process.stderr.write(`${prefix}... (0s)`);
  const interval: ReturnType<typeof setInterval> = setInterval(() => {
    const elapsed: number = Math.round((Date.now() - start) / 1000);
    process.stderr.clearLine(0);
    process.stderr.cursorTo(0);
    process.stderr.write(`${prefix}... (${elapsed}s)`);
  }, 1000);

  return { interval };
}

function stopTicker(ticker: Ticker | null): void {
  if (!ticker) return;
  clearInterval(ticker.interval);
  if (process.stderr.isTTY) {
    process.stderr.clearLine(0);
    process.stderr.cursorTo(0);
  }
}
