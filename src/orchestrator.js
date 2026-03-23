import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validate } from './validation.js';
import { invoke } from './agent.js';
import { update as updateSession, listTurnFiles } from './session.js';
import { atomicWrite } from './util.js';
import { parseActions, executeActions } from './actions.js';

/**
 * Run the orchestrator turn loop.
 * When a server is provided, supports interjection queue, pause/resume, and end-session.
 */
export async function run(session, { server } = {}) {
  // Initialize child process tracking for SIGINT cleanup
  session._currentChild = null;

  let turnCount = session.current_turn;
  let nextAgent = session.next_agent;
  let endRequested = false;

  // Phase tracking
  let phase = session.phase || 'debate';

  // Consensus tracking for debate phase — derive from turn history on recovery
  let pendingDecided = null;

  // Review turn counter — derive from turn history on recovery
  let reviewTurnCount = 0;

  // On recovery, reconstruct ephemeral state from turn history
  if (session.current_turn > 0) {
    const recovered = await recoverEphemeralState(session);
    pendingDecided = recovered.pendingDecided;
    reviewTurnCount = recovered.reviewTurnCount;
  }

  // Interjection queue and pause state (active when server is present)
  const interjectionQueue = [];
  let isPaused = false;
  let humanResponseResolve = null;

  let thinkingAgent = null;
  let thinkingSince = null;

  const controller = {
    get isPaused() { return isPaused; },
    get endRequested() { return endRequested; },
    get thinking() { return thinkingAgent ? { agent: thinkingAgent, since: thinkingSince } : null; },
    get phase() { return phase; },
    interject(content) {
      if (isPaused && humanResponseResolve) {
        humanResponseResolve(content);
        humanResponseResolve = null;
      } else {
        interjectionQueue.push(content);
      }
    },
    requestEnd() {
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
      const implModel = session.impl_model;
      nextAgent = implModel === 'claude' ? 'codex' : 'claude';
    }

    // Invoke agent with one retry on failure
    thinkingAgent = nextAgent;
    thinkingSince = new Date().toISOString();
    let result = await invokeWithRetry(nextAgent, session, turnCount);
    thinkingAgent = null;
    thinkingSince = null;

    if (!result.ok) {
      await writeErrorTurn(session, turnCount, nextAgent, result.reason, result.rawOutput);
      const resumed = await pauseOrExit(turnCount, server);
      if (resumed) continue;
      break;
    }

    // Validate with one retry on failure
    let validation = validate(result.output, nextAgent);
    if (!validation.valid) {
      console.log(`[Turn ${turnCount}] Invalid output: ${validation.errors.join(', ')}. Retrying...`);
      result = await invokeOnce(nextAgent, session);
      validation = result.ok ? validate(result.output, nextAgent) : { valid: false, errors: ['retry failed'] };

      if (!validation.valid) {
        await writeErrorTurn(session, turnCount, nextAgent,
          `invalid frontmatter: ${validation.errors.join(', ')}`, result.rawOutput || result.output);
        const resumed = await pauseOrExit(turnCount, server);
        if (resumed) continue;
        break;
      }
    }

    // Orchestrator assigns canonical turn number, id, filename
    const canonicalId = `turn-${String(turnCount).padStart(4, '0')}-${nextAgent}`;
    const normalizedStatus = normalizeStatus(validation.data.status, turnCount);
    const canonicalData = {
      id: canonicalId,
      turn: turnCount,
      from: nextAgent,
      timestamp: new Date().toISOString(),
      status: normalizedStatus,
    };
    if (validation.data.decisions) {
      canonicalData.decisions = validation.data.decisions;
    }

    if (normalizedStatus !== validation.data.status) {
      console.log(`[Turn ${turnCount}] Agent signaled ${validation.data.status} too early — downgrading to complete.`);
    }

    await writeCanonicalTurn(session, canonicalId, canonicalData, validation.content);
    console.log(`[Turn ${turnCount}] [${phase}] Written: ${canonicalId} (status: ${canonicalData.status})`);

    const oppositeAgent = nextAgent === 'claude' ? 'codex' : 'claude';

    // === Phase-specific post-turn logic ===

    if (phase === 'debate') {
      await updateSession(session.dir, {
        current_turn: turnCount,
        next_agent: oppositeAgent,
      });

      // Check for consensus signaling
      if (canonicalData.status === 'decided') {
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
        if (pendingDecided && canonicalData.status === 'complete') {
          console.log(`[Turn ${turnCount}] ${nextAgent} contests consensus. Resuming debate.`);
          pendingDecided = null;
        }

        if (canonicalData.status === 'done') {
          console.log(`[Turn ${turnCount}] Agent signaled done. Ending session.`);
          break;
        }

        if (canonicalData.status === 'needs_human') {
          if (server) {
            isPaused = true;
            await updateSession(session.dir, { session_status: 'paused' });
            console.log(`[Turn ${turnCount}] Agent needs human input. Paused.`);

            const humanContent = await waitForHuman();
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
        const results = await executeActions(actions, session.target_repo);

        const succeeded = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok).length;
        console.log(`[Turn ${turnCount}] Actions: ${succeeded} succeeded, ${failed} failed.`);

        // Store action results for review
        await writeActionResults(session, turnCount, results);
      }

      // Transition to review
      console.log(`[Turn ${turnCount}] Implementation turn complete. Transitioning to review phase.`);
      phase = 'review';
      reviewTurnCount = 0;
      const reviewer = session.impl_model === 'claude' ? 'codex' : 'claude';
      nextAgent = reviewer;
      await updateSession(session.dir, {
        current_turn: turnCount,
        phase: 'review',
        next_agent: reviewer,
      });
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
      const content = interjectionQueue.shift();
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

  function waitForHuman() {
    return new Promise((resolve) => {
      humanResponseResolve = resolve;
    });
  }

  async function pauseOrExit(turn, srv) {
    await updateSession(session.dir, {
      current_turn: turn,
      session_status: srv ? 'paused' : 'completed',
    });

    if (srv) {
      isPaused = true;
      console.log(`[Turn ${turn}] Paused after error. Waiting for human...`);
      const humanContent = await waitForHuman();
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
async function recoverEphemeralState(session) {
  const turnsDir = join(session.dir, 'turns');
  const turnFiles = await listTurnFiles(turnsDir);

  let pendingDecided = null;
  let reviewTurnCount = 0;
  let inReviewPhase = false;

  for (const file of turnFiles) {
    const raw = await readFile(join(turnsDir, file), 'utf8');
    const parsed = validate(raw);
    if (!parsed.valid) continue;

    const { status, from } = parsed.data;

    // Track consensus state: if the last decided was uncontested, it's still pending
    if (status === 'decided') {
      if (pendingDecided && pendingDecided !== from) {
        // Both agents agreed — consensus was reached, implementation follows
        pendingDecided = null;
        inReviewPhase = true;
      } else {
        pendingDecided = from;
      }
    } else if (status === 'complete' && pendingDecided) {
      // Contested — clear pending
      pendingDecided = null;
    }

    // Count review-phase turns (turns after the phase transitioned to review)
    if (session.phase === 'review' || session.phase === 'implement') {
      // If we see a turn from the non-impl agent after consensus, it's a review turn
      const reviewer = session.impl_model === 'claude' ? 'codex' : 'claude';
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
export function normalizeStatus(agentStatus, turnCount) {
  if (agentStatus === 'done' && turnCount < 2) return 'complete';
  if (agentStatus === 'done') return 'done';
  if (agentStatus === 'decided' && turnCount < 2) return 'complete';
  if (agentStatus === 'decided') return 'decided';
  if (agentStatus === 'needs_human') return 'needs_human';
  return 'complete';
}

// --- Agent invocation helpers ---

async function invokeOnce(agentName, session) {
  const result = await invoke(agentName, { ...session, next_agent: agentName });
  const failed = result.timedOut || result.exitCode !== 0 || !result.output.trim();
  const reason = result.timedOut
    ? 'timeout (180s)'
    : result.exitCode !== 0
      ? `exit code ${result.exitCode}`
      : 'empty output';
  return { ok: !failed, output: result.output, rawOutput: result.output, reason };
}

async function invokeWithRetry(agentName, session, turnCount) {
  let ticker = startTicker(turnCount, agentName);
  let result = await invokeOnce(agentName, session);
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

async function writeCanonicalTurn(session, id, data, content) {
  const filename = `${id}.md`;
  const turnsDir = join(session.dir, 'turns');
  await mkdir(turnsDir, { recursive: true }); // ensure dir exists (agents may interfere)
  const finalPath = join(turnsDir, filename);

  // Build frontmatter manually — do NOT use matter.stringify because it re-parses
  // the content body, allowing agents to inject frontmatter via embedded --- blocks.
  const frontmatter = '---\n' + yaml.dump(data, { lineWidth: -1 }).trim() + '\n---\n';
  await atomicWrite(finalPath, frontmatter + content + '\n');
}

async function writeErrorTurn(session, turnCount, agent, reason, rawOutput) {
  const id = `turn-${String(turnCount).padStart(4, '0')}-${agent}`;
  const data = {
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

async function writeHumanTurn(session, turnCount, content) {
  const id = `turn-${String(turnCount).padStart(4, '0')}-human`;
  const data = {
    id,
    turn: turnCount,
    from: 'human',
    timestamp: new Date().toISOString(),
    status: 'complete',
  };
  await writeCanonicalTurn(session, id, data, content);
}

async function writeActionResults(session, turnCount, results) {
  const artifactsDir = join(session.dir, 'artifacts');
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

async function generateDecisions(session) {
  const turnsDir = join(session.dir, 'turns');
  const turnFiles = await listTurnFiles(turnsDir);
  if (turnFiles.length === 0) return;

  const decisions = [];
  for (const file of turnFiles) {
    const raw = await readFile(join(turnsDir, file), 'utf8');
    const parsed = validate(raw);
    if (parsed.valid && parsed.data.decisions) {
      for (const d of parsed.data.decisions) {
        decisions.push({ turn: parsed.data.turn, from: parsed.data.from, decision: d });
      }
    }
  }

  if (decisions.length === 0) {
    console.log('No decisions found in turn frontmatter. Skipping decisions.md.');
    return;
  }

  const lines = ['# Decisions Log', ''];
  for (const { turn, from, decision } of decisions) {
    lines.push(`${turn}. **[${from}]** ${decision}`);
  }
  lines.push('');

  const artifactsDir = join(session.dir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const decisionsPath = join(artifactsDir, 'decisions.md');
  await atomicWrite(decisionsPath, lines.join('\n'));
  console.log(`Decisions log written: ${decisionsPath} (${decisions.length} decision(s))`);
}

// --- CLI progress ticker ---

function startTicker(turnCount, agent, label) {
  const start = Date.now();
  const isTTY = process.stderr.isTTY;
  const prefix = label
    ? `[Turn ${turnCount}] ${label}: ${agent}`
    : `[Turn ${turnCount}] Invoking ${agent}`;

  if (!isTTY) {
    console.log(`${prefix}...`);
    return null;
  }

  process.stderr.write(`${prefix}... (0s)`);
  const interval = setInterval(() => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stderr.clearLine(0);
    process.stderr.cursorTo(0);
    process.stderr.write(`${prefix}... (${elapsed}s)`);
  }, 1000);

  return { interval };
}

function stopTicker(ticker) {
  if (!ticker) return;
  clearInterval(ticker.interval);
  if (process.stderr.isTTY) {
    process.stderr.clearLine(0);
    process.stderr.cursorTo(0);
  }
}
