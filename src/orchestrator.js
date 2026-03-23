import { writeFile, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { validate } from './validation.js';
import { invoke } from './agent.js';
import { update as updateSession, atomicWriteJson } from './session.js';

/**
 * Run the orchestrator turn loop (Phase 1: headless).
 * Phase 2 adds: server, interjection queue, pause/resume, endRequested.
 */
export async function run(session, { server } = {}) {
  let turnCount = session.current_turn;
  let nextAgent = session.next_agent;
  let endRequested = false;

  // Phase 2: interjection queue and pause state
  const interjectionQueue = [];
  let isPaused = false;
  let humanResponseResolve = null;

  // Expose control interface for server (Phase 2)
  const controller = {
    get isPaused() { return isPaused; },
    get endRequested() { return endRequested; },
    interject(content) {
      if (isPaused && humanResponseResolve) {
        // Direct resume — bypass queue
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

  // Start server if provided
  if (server) {
    await server.start(session, controller);
  }

  while (turnCount < session.max_turns && !endRequested) {
    turnCount++;

    // Invoke agent
    console.log(`[Turn ${turnCount}] Invoking ${nextAgent}...`);
    let result = await invoke(nextAgent, { ...session, next_agent: nextAgent });

    // Handle timeout/error with one retry
    if (result.timedOut || result.exitCode !== 0 || !result.output.trim()) {
      const reason = result.timedOut
        ? 'timeout (120s)'
        : result.exitCode !== 0
          ? `exit code ${result.exitCode}`
          : 'empty output';
      console.log(`[Turn ${turnCount}] ${nextAgent} failed: ${reason}. Retrying...`);

      result = await invoke(nextAgent, { ...session, next_agent: nextAgent });

      if (result.timedOut || result.exitCode !== 0 || !result.output.trim()) {
        // Write error turn and exit (Phase 1) or pause (Phase 2)
        const errorReason = result.timedOut ? 'timeout' : `exit code ${result.exitCode}`;
        await writeErrorTurn(session, turnCount, nextAgent, errorReason, result.output);
        await updateSession(session.dir, {
          current_turn: turnCount,
          session_status: server ? 'paused' : 'completed',
        });

        if (server) {
          // Phase 2: pause for human
          isPaused = true;
          console.log(`[Turn ${turnCount}] Paused after error. Waiting for human...`);
          const humanContent = await waitForHuman();
          isPaused = false;
          turnCount++;
          await writeHumanTurn(session, turnCount, humanContent);
          await updateSession(session.dir, {
            current_turn: turnCount,
            session_status: 'active',
          });
          // Same agent retries after human input
          continue;
        }

        console.log(`[Turn ${turnCount}] Exiting after error.`);
        break;
      }
    }

    // Validate output
    let validation = validate(result.output, nextAgent);

    if (!validation.valid) {
      console.log(`[Turn ${turnCount}] Invalid output from ${nextAgent}: ${validation.errors.join(', ')}. Retrying...`);
      result = await invoke(nextAgent, { ...session, next_agent: nextAgent });
      validation = validate(result.output, nextAgent);

      if (!validation.valid) {
        await writeErrorTurn(
          session, turnCount, nextAgent,
          `invalid frontmatter: ${validation.errors.join(', ')}`,
          result.output
        );
        await updateSession(session.dir, {
          current_turn: turnCount,
          session_status: server ? 'paused' : 'completed',
        });

        if (server) {
          isPaused = true;
          console.log(`[Turn ${turnCount}] Paused after validation error. Waiting for human...`);
          const humanContent = await waitForHuman();
          isPaused = false;
          turnCount++;
          await writeHumanTurn(session, turnCount, humanContent);
          await updateSession(session.dir, {
            current_turn: turnCount,
            session_status: 'active',
          });
          continue;
        }

        console.log(`[Turn ${turnCount}] Exiting after validation failure.`);
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
    if (validation.data.decisions && Array.isArray(validation.data.decisions)) {
      canonicalData.decisions = validation.data.decisions;
    }

    // Write canonical turn (atomic: temp → rename)
    await writeCanonicalTurn(session, canonicalId, canonicalData, validation.content);
    console.log(`[Turn ${turnCount}] Written: ${canonicalId} (status: ${canonicalData.status})`);

    // Update session state
    const oppositeAgent = nextAgent === 'claude' ? 'codex' : 'claude';
    await updateSession(session.dir, {
      current_turn: turnCount,
      next_agent: oppositeAgent,
    });

    // Check status
    if (canonicalData.status === 'done') {
      console.log(`[Turn ${turnCount}] Agent signaled done. Ending session.`);
      break;
    }

    if (canonicalData.status === 'needs_human') {
      if (server) {
        // Phase 2: pause and wait
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

      console.log(`[Turn ${turnCount}] Agent needs human input. Exiting (no UI in Phase 1).`);
      break;
    }

    // Drain interjection queue (one item per turn boundary)
    if (interjectionQueue.length > 0) {
      const content = interjectionQueue.shift();
      turnCount++;
      await writeHumanTurn(session, turnCount, content);
      await updateSession(session.dir, {
        current_turn: turnCount,
        next_agent: oppositeAgent, // Continue to next agent
      });
      console.log(`[Turn ${turnCount}] Injected human interjection.`);
    }

    nextAgent = oppositeAgent;
  }

  // Generate artifacts
  await generateDecisions(session);

  // Mark session completed
  await updateSession(session.dir, { session_status: 'completed' });
  console.log('Session completed.');

  if (server) {
    // Keep server running briefly so UI can see final state
    setTimeout(() => server.stop(), 5000);
  }

  function waitForHuman() {
    return new Promise((resolve) => {
      humanResponseResolve = resolve;
    });
  }
}

async function writeCanonicalTurn(session, id, data, content) {
  const filename = `${id}.md`;
  const turnsDir = join(session.dir, 'turns');
  const tmpPath = join(turnsDir, `${filename}.tmp`);
  const finalPath = join(turnsDir, filename);

  const frontmatter = buildFrontmatter(data);
  await writeFile(tmpPath, `${frontmatter}\n${content}\n`, 'utf8');
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

function buildFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'decisions' && Array.isArray(value)) {
      lines.push('decisions:');
      for (const d of value) {
        lines.push(`  - "${d}"`);
      }
    } else {
      lines.push(`${key}: ${typeof value === 'string' ? `"${value}"` : value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

async function generateDecisions(session) {
  const turnsDir = join(session.dir, 'turns');
  let turnFiles = [];
  try {
    turnFiles = await readdir(turnsDir);
  } catch {
    return;
  }
  turnFiles = turnFiles
    .filter((f) => f.startsWith('turn-') && f.endsWith('.md') && !f.endsWith('.tmp'))
    .sort();

  const decisions = [];
  for (const file of turnFiles) {
    const raw = await readFile(join(turnsDir, file), 'utf8');
    const validation = validate(raw);
    if (validation.valid && Array.isArray(validation.data.decisions)) {
      for (const d of validation.data.decisions) {
        decisions.push({
          turn: validation.data.turn,
          from: validation.data.from,
          decision: d,
        });
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
  await writeFile(join(artifactsDir, 'decisions.md'), lines.join('\n'), 'utf8');
  console.log(`Decisions log written: ${decisions.length} decision(s).`);
}
