import { writeFile, readFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validate } from './validation.js';
import { invoke } from './agent.js';
import { update as updateSession, listTurnFiles } from './session.js';

/**
 * Run the orchestrator turn loop.
 * When a server is provided, supports interjection queue, pause/resume, and end-session.
 */
export async function run(session, { server } = {}) {
  let turnCount = session.current_turn;
  let nextAgent = session.next_agent;
  let endRequested = false;

  // Interjection queue and pause state (active when server is present)
  const interjectionQueue = [];
  let isPaused = false;
  let humanResponseResolve = null;

  const controller = {
    get isPaused() { return isPaused; },
    get endRequested() { return endRequested; },
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

    // Invoke agent with one retry on failure
    console.log(`[Turn ${turnCount}] Invoking ${nextAgent}...`);
    let result = await invokeWithRetry(nextAgent, session, turnCount);

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
    const canonicalData = {
      id: canonicalId,
      turn: turnCount,
      from: nextAgent,
      timestamp: new Date().toISOString(),
      status: validation.data.status,
    };
    if (validation.data.decisions) {
      canonicalData.decisions = validation.data.decisions;
    }

    await writeCanonicalTurn(session, canonicalId, canonicalData, validation.content);
    console.log(`[Turn ${turnCount}] Written: ${canonicalId} (status: ${canonicalData.status})`);

    const oppositeAgent = nextAgent === 'claude' ? 'codex' : 'claude';
    await updateSession(session.dir, {
      current_turn: turnCount,
      next_agent: oppositeAgent,
    });

    // Check status — require at least 2 turns before allowing done
    if (canonicalData.status === 'done') {
      if (turnCount < 2) {
        console.log(`[Turn ${turnCount}] Agent signaled done too early — downgrading to complete.`);
        canonicalData.status = 'complete';
      } else {
        console.log(`[Turn ${turnCount}] Agent signaled done. Ending session.`);
        break;
      }
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
          next_agent: nextAgent, // Same agent resumes (R11)
        });
        continue;
      }

      console.log(`[Turn ${turnCount}] Agent needs human input. Exiting (no UI).`);
      break;
    }

    // Drain interjection queue (one item per turn boundary)
    if (interjectionQueue.length > 0) {
      const content = interjectionQueue.shift();
      turnCount++;
      await writeHumanTurn(session, turnCount, content);
      await updateSession(session.dir, {
        current_turn: turnCount,
        next_agent: oppositeAgent,
      });
      console.log(`[Turn ${turnCount}] Injected human interjection.`);
    }

    nextAgent = oppositeAgent;
  }

  // Generate artifacts
  await generateDecisions(session);
  await updateSession(session.dir, { session_status: 'completed' });
  console.log('');
  console.log('Session completed.');
  console.log(`  Turns:     ${join(session.dir, 'turns')}`);
  console.log(`  Artifacts: ${join(session.dir, 'artifacts')}`);

  if (server) {
    setTimeout(() => server.stop(), 5000);
  }

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

// --- Agent invocation helpers ---

async function invokeOnce(agentName, session) {
  const result = await invoke(agentName, { ...session, next_agent: agentName });
  const failed = result.timedOut || result.exitCode !== 0 || !result.output.trim();
  const reason = result.timedOut
    ? 'timeout (120s)'
    : result.exitCode !== 0
      ? `exit code ${result.exitCode}`
      : 'empty output';
  return { ok: !failed, output: result.output, rawOutput: result.output, reason };
}

async function invokeWithRetry(agentName, session, turnCount) {
  let result = await invokeOnce(agentName, session);
  if (!result.ok) {
    console.log(`[Turn ${turnCount}] ${agentName} failed: ${result.reason}. Retrying...`);
    result = await invokeOnce(agentName, session);
  }
  return result;
}

// --- Turn file helpers ---

async function writeCanonicalTurn(session, id, data, content) {
  const filename = `${id}.md`;
  const turnsDir = join(session.dir, 'turns');
  const tmpPath = join(turnsDir, `${filename}.tmp`);
  const finalPath = join(turnsDir, filename);

  // Build frontmatter manually — do NOT use matter.stringify because it re-parses
  // the content body, allowing agents to inject frontmatter via embedded --- blocks.
  const frontmatter = '---\n' + yaml.dump(data, { lineWidth: -1 }).trim() + '\n---\n';
  await writeFile(tmpPath, frontmatter + content + '\n', 'utf8');
  await rename(tmpPath, finalPath);
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
  await writeFile(decisionsPath, lines.join('\n'), 'utf8');
  console.log(`Decisions log written: ${decisionsPath} (${decisions.length} decision(s))`);
}
