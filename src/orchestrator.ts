import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validate } from './validation.js';
import type { TurnData, TurnStatus, ReviewVerdict } from './validation.js';
import { invoke, resolveModelName, resolveModelForParticipant } from './agent.js';
import type { ModelTier } from './agent.js';
import { update as updateSession, listTurnFiles } from './session.js';
import type { Session, SessionPhase } from './session.js';
import { atomicWrite, killChildProcess } from './util.js';
import { readInterjections, checkEndRequest } from './ipc.js';
import { createWorktree, removeWorktree, captureDiff, commitChanges, currentBranch, rescueBranchSwitch } from './worktree.js';
import { pushAndCreatePr, hasBranchDelta, parsePrRef, lookupPrHeadBranch } from './pr.js';
import { Tracer } from './trace.js';
import type { AttemptMeta } from './trace.js';
import * as ui from './ui.js';
import { getOtherParticipant, getImplementer, getReviewer } from './roster.js';
import { estimateCost, buildUsageArtifact, mergeUsage } from './cost.js';
import type { TokenUsage, UsageEntry } from './cost.js';

// ── Type definitions ────────────────────────────────────────────────

interface InvokeOnceResult {
  ok: boolean;
  output: string;
  rawOutput: string;
  reason: string;
  attemptDir?: string;
  usage?: TokenUsage;
}

export interface Controller {
  readonly isPaused: boolean;
  readonly endRequested: boolean;
  readonly thinking: { agent: string; since: string; model: string } | null;
  readonly phase: string;
  interject(content: string): void;
  requestEnd(): void;
}

export interface ServerModule {
  start(session: Session, controller: Controller): Promise<void>;
  stop(): void;
}

interface RunOptions {
  server?: ServerModule | null;
  noPr?: boolean;
  noFast?: boolean;
  noWorktree?: boolean;
}

export interface RecoveredState {
  pendingPlanDecided: string | null;
  pendingReviewDecided: { agent: string; verdict: 'approve' | 'fix' } | null;
  reviewLoopCount: number;
  bothEverDecided: boolean;
}

interface CanonicalTurnData {
  id: string;
  turn: number;
  from: string;
  timestamp: string;
  status: string;
  phase: string;
  verdict?: 'approve' | 'fix';
  duration_ms?: number;
  decisions?: string[];
  model_tier?: ModelTier;
  model_name?: string;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd?: number | null;
}

interface DecisionEntry {
  turn: number;
  from: string;
  decision: string;
}

// ── Model tier selection ────────────────────────────────────────────

/**
 * Select model tier for the current turn based on phase and consensus signals.
 * Returns 'mid' for review, 'fast' for consensus turns in plan, 'full' otherwise.
 */
export function selectModelTier(
  phase: SessionPhase,
  noFast: boolean,
  pendingPlanDecided: string | null,
  bothEverDecided: boolean,
): ModelTier {
  if (noFast) return 'full';
  if (phase === 'review') return 'mid';
  if (phase !== 'plan') return 'full';
  if (bothEverDecided) return 'fast';
  if (pendingPlanDecided) return 'fast';
  return 'full';
}

// ── Main orchestrator ───────────────────────────────────────────────

/**
 * Run the orchestrator turn loop.
 * When a server is provided, supports interjection queue, pause/resume, and end-session.
 */
export async function run(session: Session, { server, noPr, noFast, noWorktree }: RunOptions = {}): Promise<void> {
  // Initialize child process tracking for SIGINT cleanup
  session._currentChild = null;

  // Per-session attempt counters — scoped to this run() so concurrent sessions are isolated
  const attemptCounters = new Map<string, number>();

  // Initialize session tracer for durable attempt artifacts + event stream
  const tracer = new Tracer(session.dir);
  tracer.emit('session.start', {
    phase: session.phase,
    data: { topic: session.topic, mode: session.mode, max_turns: session.max_turns },
  });

  let turnCount: number = session.current_turn;
  let nextAgent: string = session.next_agent;
  let endRequested = false;

  // Phase tracking
  let phase: SessionPhase = session.phase || 'plan';

  // Consensus tracking for plan phase -- derive from turn history on recovery
  let pendingPlanDecided: string | null = null;

  // Review consensus tracking -- separate from plan consensus
  let pendingReviewDecided: { agent: string; verdict: 'approve' | 'fix' } | null = null;

  // Review loop counter -- increments only on review consensus fix transitions
  let reviewLoopCount = 0;

  // Track which participants have ever emitted decided/done in the plan phase.
  // Uses a Set instead of per-agent booleans -- supports N participants.
  const decidedParticipants = new Set<string>();
  let bothEverDecided = false;

  // Cost tracking -- accumulate per-turn usage entries
  const usageEntries: UsageEntry[] = [];
  let cumulativeCostUsd = 0;

  // Track consecutive empty-diff implement attempts to prevent infinite loops
  let emptyDiffRetries = 0;
  const MAX_EMPTY_DIFF_RETRIES = 2;

  // On recovery, reconstruct ephemeral state from turn history
  if (session.current_turn > 0) {
    const recovered: RecoveredState = await recoverEphemeralState(session);
    pendingPlanDecided = recovered.pendingPlanDecided;
    pendingReviewDecided = recovered.pendingReviewDecided;
    reviewLoopCount = recovered.reviewLoopCount;
    bothEverDecided = recovered.bothEverDecided;
    // Mark all roster participants as decided if bothEverDecided (recovery shortcut)
    if (bothEverDecided) {
      for (const p of session.roster) decidedParticipants.add(p.id);
    }

    // Recover cost/usage state so --budget enforcement survives restarts.
    // Try artifacts/usage.json first (fast path), then fall back to turn frontmatter.
    const recoveredUsage = await recoverUsageState(session);
    for (const entry of recoveredUsage) {
      usageEntries.push(entry);
      cumulativeCostUsd += entry.cost_usd ?? 0;
    }
  }

  // Apply pending review decision from recovery before entering the loop.
  // This handles the case where a review verdict was written but the
  // phase transition didn't complete before the crash.
  if (pendingReviewDecided) {
    if (pendingReviewDecided.verdict === 'approve') {
      // Skip the main loop and fall through to the shared finalization path
      // (generateDecisions, PR creation, worktree cleanup, session update).
      ui.status('recovery.approve', {});
      endRequested = true;
    } else if (reviewLoopCount >= session.review_turns) {
      // Review loop exhausted — skip to finalization like approve.
      ui.status('recovery.limit', { max: session.review_turns });
      endRequested = true;
    } else {
      // verdict === 'fix', under limit — continue to main loop
      reviewLoopCount++;
      emptyDiffRetries = 0;
      phase = 'implement';
      session.phase = phase;
      nextAgent = session.impl_model;
      tracer.emit('phase.changed', { turn: turnCount, phase, data: { from_phase: 'review', to_phase: 'implement', review_loop: reviewLoopCount, recovery: true } });
      await updateSession(session.dir, { phase: 'implement', next_agent: nextAgent });
      ui.status('recovery.fix', { loop: reviewLoopCount, max: session.review_turns });
    }
    pendingReviewDecided = null;
  }

  // Interjection queue and pause state (active when server is present)
  const interjectionQueue: string[] = [];
  let isPaused = false;
  let humanResponseResolve: ((content: string) => void) | null = null;

  let thinkingAgent: string | null = null;
  let thinkingSince: string | null = null;
  let thinkingModel: string = '';

  const controller: Controller = {
    get isPaused() { return isPaused; },
    get endRequested() { return endRequested; },
    get thinking() { return thinkingAgent ? { agent: thinkingAgent, since: thinkingSince!, model: thinkingModel } : null; },
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
      // Kill the running agent so the loop unblocks immediately
      const child = session._currentChild;
      if (child && !child.killed) {
        killChildProcess(child);
      }
    },
  };

  if (server) {
    await server.start(session, controller);
  }

  // Heartbeat writer — writes heartbeat.json every 10s for liveness detection
  const heartbeatInterval = setInterval(() => {
    const payload = JSON.stringify({ heartbeat_at: new Date().toISOString() }) + '\n';
    atomicWrite(join(session.dir, 'heartbeat.json'), payload).catch(() => {});
  }, 10_000);
  // Write initial heartbeat immediately
  atomicWrite(join(session.dir, 'heartbeat.json'), JSON.stringify({ heartbeat_at: new Date().toISOString() }) + '\n').catch(() => {});

  // File-based IPC poll loop — picks up interjections and end-requested flags
  // written by the shared server (coexists with in-memory controller methods).
  let ipcPollTimeout: ReturnType<typeof setTimeout> | null = null;
  let pollStopped = false;

  function schedulePoll(): void {
    if (pollStopped) return;
    const delay = isPaused ? 500 : 1000;
    ipcPollTimeout = setTimeout(async () => {
      try {
        // Read pending interjections from the session's interjections/ directory
        const contents = await readInterjections(session.dir);
        for (const content of contents) {
          if (isPaused && humanResponseResolve) {
            humanResponseResolve(content);
            humanResponseResolve = null;
            isPaused = false;
          } else {
            interjectionQueue.push(content);
          }
        }

        // Check for end-session request
        const shouldEnd = await checkEndRequest(session.dir);
        if (shouldEnd) {
          endRequested = true;
          if (session._currentChild) {
            killChildProcess(session._currentChild);
          }
        }

      } catch {
        // IPC poll errors are non-fatal — the next poll will retry
      }
      schedulePoll();
    }, delay);
  }
  schedulePoll();

  try {

  while (turnCount < session.max_turns && !endRequested) {
    turnCount++;

    // In implement phase, only the implementer takes turns (roster lookup)
    if (phase === 'implement') {
      nextAgent = getImplementer(session.roster).id;
    }
    // In review phase, only the reviewer takes turns (roster lookup)
    if (phase === 'review') {
      nextAgent = getReviewer(session.roster).id;
    }

    // Budget enforcement -- check before invoking
    if (session.budget && cumulativeCostUsd >= session.budget) {
      ui.status('end.requested', { turn: turnCount });
      break;
    }

    // Select model tier for this turn (may be upgraded to 'full' on validation retry)
    let currentTier = selectModelTier(phase, !!noFast, pendingPlanDecided, bothEverDecided);

    // Invoke agent with one retry on failure
    thinkingAgent = nextAgent;
    thinkingSince = new Date().toISOString();
    thinkingModel = resolveModelForParticipant(nextAgent, session, currentTier);
    atomicWrite(join(session.dir, 'thinking.json'), JSON.stringify({ agent: thinkingAgent, since: thinkingSince, model: thinkingModel }) + '\n').catch(() => {});
    const invokeStart: number = Date.now();
    const retryResult = await invokeWithRetry(nextAgent, session, turnCount, tracer, attemptCounters, () => endRequested, currentTier);
    let result: InvokeOnceResult = retryResult;
    // Accumulate usage across all invocations in this turn (initial + retries)
    let turnUsage: TokenUsage | undefined = retryResult.usage;
    if (retryResult.effectiveTier) currentTier = retryResult.effectiveTier;
    const durationMs: number = Date.now() - invokeStart;
    thinkingAgent = null;
    thinkingSince = null;
    atomicWrite(join(session.dir, 'thinking.json'), JSON.stringify({ agent: null, since: null, model: null }) + '\n').catch(() => {});

    if (endRequested) {
      ui.status('end.requested', { turn: turnCount });
      break;
    }

    if (!result.ok) {
      tracer.emit('turn.error', { turn: turnCount, agent: nextAgent, phase, data: { reason: result.reason } });
      await writeErrorTurn(session, turnCount, nextAgent, result.reason, result.rawOutput, currentTier);
      const resumed: boolean = await pauseOrExit(turnCount, server ?? null);
      if (resumed) continue;
      break;
    }

    // Validate with one retry on failure
    let validation = validate(result.output, nextAgent);
    if (!validation.valid) {
      const preview = result.output.slice(0, 200).replace(/\n/g, '\\n');
      ui.status('turn.invalid', { turn: turnCount, preview, errors: validation.errors });
      tracer.emit('attempt.validation_failed', { turn: turnCount, agent: nextAgent, phase, data: { errors: validation.errors } });

      // Persist validation errors into the attempt's meta.json
      if (result.attemptDir) {
        await tracer.updateAttemptMeta(result.attemptDir, { validation_errors: validation.errors });
      }

      // In implement phase, the frontmatter is ceremonial — the orchestrator
      // assigns canonical values and the real output is the git diff.
      // Synthesize frontmatter instead of crashing.
      if (phase === 'implement') {
        ui.status('turn.synthesize', { turn: turnCount });
        validation = {
          valid: true,
          errors: [],
          data: {
            id: `turn-${String(turnCount).padStart(4, '0')}-${nextAgent}`,
            turn: turnCount,
            from: nextAgent,
            timestamp: new Date().toISOString(),
            status: 'complete' as TurnStatus,
          },
          content: result.output.trim(),
        };
      } else {
        // Validation retry always uses the full model — if a non-full model produced
        // invalid frontmatter, escalating to full is the right fallback.
        if (currentTier !== 'full') {
          ui.status('tier.escalation', { turn: turnCount });
        } else {
          ui.status('turn.retry', { turn: turnCount });
        }
        result = await invokeOnce(nextAgent, session, turnCount, tracer, attemptCounters, 'validation-retry', 'full');
        turnUsage = mergeUsage(turnUsage, result.usage);
        validation = result.ok ? validate(result.output, nextAgent) : { valid: false, errors: ['retry failed'], data: null, content: '' };

        // If retry succeeded with full model, update the tier for this turn's metadata
        if (validation.valid && currentTier !== 'full') {
          currentTier = 'full';
        }

        if (!validation.valid) {
          // Persist validation errors into the retry attempt's meta.json
          if (result.attemptDir) {
            await tracer.updateAttemptMeta(result.attemptDir, { validation_errors: validation.errors });
          }
          tracer.emit('turn.error', { turn: turnCount, agent: nextAgent, phase, data: { reason: 'invalid frontmatter after retry', errors: validation.errors } });
          await writeErrorTurn(session, turnCount, nextAgent,
            `invalid frontmatter: ${validation.errors.join(', ')}`, result.rawOutput || result.output, currentTier);
          const resumed: boolean = await pauseOrExit(turnCount, server ?? null);
          if (resumed) continue;
          break;
        }
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
    canonicalData.model_tier = currentTier;
    canonicalData.model_name = resolveModelForParticipant(nextAgent, session, currentTier);

    // Review-phase verdict handling:
    // - Legacy 'done' maps to decided + verdict:approve (compat shim)
    // - 'decided' with verdict passes through
    // - 'decided' without verdict: retry once, then error (never silently approve)
    if (phase === 'review' && normalizedStatus === 'decided') {
      if (validData.status === 'done') {
        // Legacy compat: done in review = approve
        canonicalData.verdict = 'approve';
      } else if (validData.verdict) {
        canonicalData.verdict = validData.verdict;
      } else {
        // decided without verdict — retry once
        ui.status('review.no.verdict', { turn: turnCount });
        const verdictRetry = await invokeOnce(nextAgent, session, turnCount, tracer, attemptCounters, 'verdict-retry');
        turnUsage = mergeUsage(turnUsage, verdictRetry.usage);
        const retryValidation = verdictRetry.ok ? validate(verdictRetry.output, nextAgent) : { valid: false, errors: ['retry failed'], data: null, content: '' };
        const retryStatus = retryValidation.valid ? normalizeStatus(retryValidation.data!.status, turnCount, phase) : null;
        const retryIsValidReview = retryStatus === 'decided' && retryValidation.data?.verdict;
        const retryIsLegacyDone = retryValidation.valid && retryValidation.data!.status === 'done';
        if (retryValidation.valid && (retryIsValidReview || retryIsLegacyDone)) {
          // Fully replace the turn output with the retry's result
          const retryData = retryValidation.data!;
          canonicalData.status = retryIsLegacyDone ? 'decided' : retryStatus!;
          canonicalData.verdict = retryIsLegacyDone ? 'approve' : retryData.verdict!;
          if (retryData.decisions) {
            canonicalData.decisions = retryData.decisions;
          }
          validation = retryValidation;
        } else {
          // Still no verdict after retry — write error turn and pause/exit
          const reason = 'review decided without verdict after retry';
          await writeErrorTurn(session, turnCount, nextAgent, reason, verdictRetry.ok ? verdictRetry.output : verdictRetry.reason, currentTier);
          const resumed: boolean = await pauseOrExit(turnCount, server ?? null);
          if (resumed) continue;
          break;
        }
      }
    }

    // Attach accumulated token usage and cost estimate from all invocations in this turn.
    // This runs AFTER all retry paths (validation retry, verdict retry) so the totals
    // reflect every invocation, not just the initial one.
    if (turnUsage) {
      canonicalData.tokens_in = turnUsage.input_tokens ?? null;
      canonicalData.tokens_out = turnUsage.output_tokens ?? null;
      const modelName = canonicalData.model_name;
      canonicalData.cost_usd = estimateCost(modelName, turnUsage);
    }

    if (normalizedStatus !== validData.status) {
      ui.status('turn.downgrade', { turn: turnCount, claimed: validData.status });
    }

    await writeCanonicalTurn(session, canonicalId, canonicalData, validation.content);
    await savePromptForTurn(session, canonicalId);
    tracer.emit('turn.written', { turn: turnCount, agent: nextAgent, phase, data: { id: canonicalId, status: canonicalData.status, duration_ms: durationMs } });
    ui.status('turn.written', { turn: turnCount, phase, tier: currentTier, id: canonicalId, status: canonicalData.status });

    // Accumulate usage entry for cost tracking
    if (canonicalData.tokens_in !== undefined || canonicalData.cost_usd !== undefined) {
      usageEntries.push({
        turn: turnCount,
        from: nextAgent,
        model: canonicalData.model_name ?? '',
        tokens_in: canonicalData.tokens_in ?? null,
        tokens_out: canonicalData.tokens_out ?? null,
        cost_usd: canonicalData.cost_usd ?? null,
        duration_ms: durationMs,
      });
      cumulativeCostUsd += canonicalData.cost_usd ?? 0;
    }

    // Write usage artifact after each turn (atomic)
    if (usageEntries.length > 0) {
      const usageArtifact = buildUsageArtifact(usageEntries);
      const artifactsDir = join(session.dir, 'artifacts');
      await mkdir(artifactsDir, { recursive: true });
      await atomicWrite(join(artifactsDir, 'usage.json'), JSON.stringify(usageArtifact, null, 2) + '\n');
    }

    const oppositeAgent = getOtherParticipant(session.roster, nextAgent).id;

    // === Phase-specific post-turn logic ===

    if (phase === 'plan') {
      await updateSession(session.dir, {
        current_turn: turnCount,
        next_agent: oppositeAgent,
      });

      // Check for consensus signaling -- treat 'done' as 'decided' in edit mode.
      // Also treat 'needs_human' as 'decided': plan-phase agents have read-only
      // access, so needs_human typically means the agent wants to implement
      // changes rather than genuinely needing human input.
      const effectiveStatus = (canonicalData.status === 'done' || canonicalData.status === 'decided' || canonicalData.status === 'needs_human')
        ? 'decided' : canonicalData.status;

      if (canonicalData.status === 'needs_human') {
        ui.status('human.auto.decided', { turn: turnCount, agent: nextAgent });
      }

      if (effectiveStatus === 'decided') {
        // Track per-participant decided for fast-model heuristic (Set-based)
        decidedParticipants.add(nextAgent);
        bothEverDecided = session.roster.every(p => decidedParticipants.has(p.id));

        if (pendingPlanDecided && pendingPlanDecided !== nextAgent) {
          // Both agents agreed — consensus reached
          tracer.emit('consensus.reached', { turn: turnCount, phase, data: { agents: [pendingPlanDecided, nextAgent] } });
          ui.status('consensus.reached', { turn: turnCount });

          // Generate plan artifact from plan-phase turns
          await generatePlan(session);

          // Planning mode: no implementation, session ends here
          if (session.mode === 'planning') {
            ui.status('phase.planning.done', { turn: turnCount });
            break;
          }

          // Create worktree for isolated implementation (unless --no-worktree).
          // Without a worktree, agents operate directly on the user's checkout.
          if (session.mode === 'edit' && !noWorktree) {
            try {
              // Resolve base branch from PR URL in topic (if any)
              let baseOverride: string | undefined;
              const prRef = parsePrRef(session.topic);
              if (prRef) {
                const headBranch = await lookupPrHeadBranch(prRef);
                if (headBranch) baseOverride = headBranch;
              }

              const { worktreePath, branchName, baseRef } = await createWorktree(
                session.target_repo, session.id, session.topic, baseOverride,
              );
              session.original_repo = session.target_repo;
              session.worktree_path = worktreePath;
              session.branch_name = branchName;
              session.base_ref = baseRef;
              session.target_repo = worktreePath;
              await updateSession(session.dir, {
                worktree_path: worktreePath,
                branch_name: branchName,
                base_ref: baseRef,
                original_repo: session.original_repo,
                target_repo: worktreePath,
              });
              ui.status('worktree.created', { turn: turnCount, branch: branchName });
            } catch (err: unknown) {
              // Hard error: never allow implement phase in main checkout
              const reason = `worktree creation failed: ${(err as Error).message}`;
              await writeErrorTurn(session, turnCount, nextAgent, reason, '', currentTier);
              const resumed: boolean = await pauseOrExit(turnCount, server ?? null);
              if (resumed) continue;
              break;
            }
          }

          phase = 'implement';
          session.phase = phase;
          pendingPlanDecided = null;
          nextAgent = session.impl_model;
          tracer.emit('phase.changed', { turn: turnCount, phase, data: { from_phase: 'plan', to_phase: 'implement' } });
          await updateSession(session.dir, {
            phase: 'implement',
            next_agent: nextAgent,
          });
          continue;
        } else {
          // First decided — record and let the other agent respond
          pendingPlanDecided = nextAgent;
          ui.status('consensus.pending', { turn: turnCount, agent: nextAgent, waiting: oppositeAgent });
          nextAgent = oppositeAgent;
        }
      } else {
        // If there was a pending decided and this agent didn't confirm, clear it
        if (pendingPlanDecided && effectiveStatus === 'complete') {
          ui.status('consensus.contested', { turn: turnCount, agent: nextAgent });
          pendingPlanDecided = null;
        }

        nextAgent = oppositeAgent;
      }
    } else if (phase === 'implement') {
      // Agent made changes directly via native tool access.
      // Capture a git diff to record what changed.
      const diff = await captureDiff(session.target_repo);
      if (diff) {
        emptyDiffRetries = 0;
        ui.status('diff.captured', { turn: turnCount });
        await writeDiffArtifact(session, turnCount, diff);

        // Commit changes to the branch so they survive worktree removal
        const committed = await commitChanges(session.target_repo, `def: implement turn ${turnCount}`);
        if (committed) {
          ui.status('changes.committed', { turn: turnCount });
        }

        // Transition to review
        ui.status('impl.to.review', { turn: turnCount });
        phase = 'review';
        session.phase = phase;
        pendingReviewDecided = null;
        const reviewer = getReviewer(session.roster).id;
        nextAgent = reviewer;
        tracer.emit('phase.changed', { turn: turnCount, phase, data: { from_phase: 'implement', to_phase: 'review' } });
        await updateSession(session.dir, {
          current_turn: turnCount,
          phase: 'review',
          next_agent: reviewer,
        });
      } else {
        emptyDiffRetries++;
        if (emptyDiffRetries >= MAX_EMPTY_DIFF_RETRIES) {
          ui.status('no.changes.limit', { turn: turnCount, max: MAX_EMPTY_DIFF_RETRIES });
          break;
        }
        ui.status('no.changes', { turn: turnCount, attempt: emptyDiffRetries, max: MAX_EMPTY_DIFF_RETRIES });
        await updateSession(session.dir, { current_turn: turnCount });
      }
    } else if (phase === 'review') {
      if (canonicalData.status === 'decided' && canonicalData.verdict) {
        // Review agent emitted a verdict
        if (canonicalData.verdict === 'approve') {
          ui.status('review.approved', { turn: turnCount });
          break;
        }

        // verdict === 'fix' — check review loop budget
        if (reviewLoopCount >= session.review_turns) {
          ui.status('review.limit', { turn: turnCount, max: session.review_turns });
          break;
        }

        // Increment review loop count on fix verdict transition back to implement
        reviewLoopCount++;

        // Reset emptyDiffRetries when transitioning from review back to implement
        emptyDiffRetries = 0;

        // Switch back to implement for fixes
        ui.status('review.fixes', { turn: turnCount, loop: reviewLoopCount, max: session.review_turns });
        phase = 'implement';
        session.phase = phase;
        nextAgent = session.impl_model;
        tracer.emit('phase.changed', { turn: turnCount, phase, data: { from_phase: 'review', to_phase: 'implement', review_loop: reviewLoopCount } });
        await updateSession(session.dir, {
          current_turn: turnCount,
          phase: 'implement',
          next_agent: nextAgent,
        });
      } else {
        // Non-decided review turn (complete, needs_human, etc.) — update session
        await updateSession(session.dir, {
          current_turn: turnCount,
          next_agent: oppositeAgent,
        });
        nextAgent = oppositeAgent;
      }
    }

    // Drain interjection queue (one item per turn boundary, debate phase only)
    if (phase === 'plan' && interjectionQueue.length > 0) {
      const content: string = interjectionQueue.shift()!;
      turnCount++;
      await writeHumanTurn(session, turnCount, content);
      await updateSession(session.dir, {
        current_turn: turnCount,
        next_agent: oppositeAgent,
      });
      ui.status('interjection', { turn: turnCount });
    }

    // Warn about dropped interjections on phase transitions
    if (phase !== 'plan' && interjectionQueue.length > 0) {
      ui.status('interjection.dropped', { turn: turnCount, count: interjectionQueue.length });
      interjectionQueue.length = 0;
    }
  }

  // Generate artifacts
  await generateDecisions(session);

  // Commit any remaining uncommitted changes before push/PR (safety net).
  // First, detect if the agent switched branches inside the worktree.
  // If so, rescue commits onto the DEF branch so the PR captures them.
  if (session.worktree_path && session.branch_name) {
    const actual = await currentBranch(session.worktree_path);
    if (actual && actual !== session.branch_name) {
      ui.status('branch.switched', { expected: session.branch_name, actual });
      await rescueBranchSwitch(session.worktree_path, session.branch_name, actual);
    }
    await commitChanges(session.worktree_path, 'def: final changes').catch(() => {});
  }

  // Push branch and create PR from worktree (before cleanup).
  // Worktree cleanup is in a finally-style path so it always happens.
  try {
    if (session.worktree_path && session.branch_name && session.mode === 'edit' && !noPr) {
      const deltaOut: { resolvedRef?: string } = {};
      const delta = await hasBranchDelta(session.worktree_path, session.base_ref, deltaOut);
      // Use the resolved ref (may differ from session.base_ref if original was deleted)
      const effectiveBase = deltaOut.resolvedRef ?? session.base_ref;
      if (delta) {
        const prResult = await pushAndCreatePr({
          repoPath: session.worktree_path,
          branchName: session.branch_name,
          baseRef: effectiveBase,
          title: `def: ${session.topic}`,
          sessionDir: session.dir,
          topic: session.topic,
          sessionId: session.id,
        });
        if (prResult) {
          session.pr_url = prResult.url;
          session.pr_number = prResult.number;
          tracer.emit('pr.created', { phase, data: { url: prResult.url, number: prResult.number } });
          ui.status('pr.created', { url: prResult.url });
        }
      } else {
        ui.status('pr.skipped', {});
      }
    }
  } finally {
    // Clean up worktree (branch persists for push/PR).
    // Also handled in shutdown handler for SIGINT — removeWorktree is idempotent.
    if (session.worktree_path && session.original_repo) {
      try {
        await removeWorktree(session.original_repo, session.worktree_path);
      } catch { /* best effort */ }
      // Restore target_repo to original so session.json reflects the real repo path
      session.target_repo = session.original_repo;
    }
  }

  tracer.emit('session.end', { phase, data: { turn_count: turnCount, pr_url: session.pr_url ?? null } });
  await tracer.flush();

  await updateSession(session.dir, {
    session_status: 'completed',
    phase,
    target_repo: session.target_repo,
    pr_url: session.pr_url ?? null,
    pr_number: session.pr_number ?? null,
  });
  ui.outro({
    phase,
    branch: session.branch_name,
    pr: session.pr_url,
    turnsDir: join(session.dir, 'turns'),
    artifactsDir: join(session.dir, 'artifacts'),
  });

  } finally {
    clearInterval(heartbeatInterval);
    pollStopped = true;
    if (ipcPollTimeout) clearTimeout(ipcPollTimeout);
  }

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
      ui.status('error.pause', { turn });
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

    ui.status('error.exit', { turn });
    return false;
  }
}

// --- Recovery helpers ---

/**
 * Reconstruct ephemeral state from turn history on session recovery.
 * Uses canonical turn `phase` data rather than inferring phase from transitions.
 *
 * Review model: single-agent verdict (the reviewer alone decides approve/fix).
 * A review `decided` turn sets a pending verdict. An implement turn following
 * it means the fix transition completed (increment reviewLoopCount, clear pending).
 * If no implement turn follows, the verdict is still pending and the live loop
 * must apply it on startup.
 *
 * Returns { pendingPlanDecided, pendingReviewDecided, reviewLoopCount }.
 */
export async function recoverEphemeralState(session: Session): Promise<RecoveredState> {
  const turnsDir: string = join(session.dir, 'turns');
  const turnFiles: string[] = await listTurnFiles(turnsDir);

  let pendingPlanDecided: string | null = null;
  let pendingReviewDecided: { agent: string; verdict: 'approve' | 'fix' } | null = null;
  let reviewLoopCount = 0;
  // Track which participants have ever decided (Set-based, supports N participants)
  const decidedParticipants = new Set<string>();

  for (const file of turnFiles) {
    const raw: string = await readFile(join(turnsDir, file), 'utf8');
    const parsed = validate(raw);
    if (!parsed.valid || !parsed.data) continue;

    const { status, from } = parsed.data;
    const turnPhase = (parsed.data as Record<string, unknown>).phase as string | undefined;
    const verdict = (parsed.data as Record<string, unknown>).verdict as 'approve' | 'fix' | undefined;

    if (turnPhase === 'plan' || turnPhase === 'debate') {
      // Plan-phase consensus tracking (generic participant model)
      if (status === 'decided' || status === 'done') {
        // Track per-participant decided for fast-model heuristic (monotonically additive)
        decidedParticipants.add(from);

        if (pendingPlanDecided && pendingPlanDecided !== from) {
          // Both agents agreed -- plan consensus reached
          pendingPlanDecided = null;
        } else {
          pendingPlanDecided = from;
        }
      } else if (status === 'complete' && pendingPlanDecided) {
        // Contested -- clear pending
        pendingPlanDecided = null;
      }
    } else if (turnPhase === 'review') {
      // Review-phase: single-agent verdict model.
      // Only track verdicts we can trust:
      // - Legacy 'done' -> approve (compat shim)
      // - 'decided' with verdict -> use it
      // - 'decided' without verdict -> skip (the live loop would have errored/retried)
      if (status === 'done') {
        // Legacy compat: done in review = approve
        pendingReviewDecided = { agent: from, verdict: 'approve' };
      } else if (status === 'decided' && verdict) {
        pendingReviewDecided = { agent: from, verdict };
      }
      // decided without verdict: the live loop errored -- don't set pending
    } else if (turnPhase === 'implement') {
      // An implement turn after a pending review fix means the transition completed
      if (pendingReviewDecided && pendingReviewDecided.verdict === 'fix') {
        reviewLoopCount++;
      }
      pendingReviewDecided = null;
    }
  }

  // Check if all roster participants have ever decided
  const rosterIds = session.roster ? session.roster.map(p => p.id) : ['claude', 'codex'];
  const bothEverDecided = rosterIds.every(id => decidedParticipants.has(id));

  return { pendingPlanDecided, pendingReviewDecided, reviewLoopCount, bothEverDecided };
}

/**
 * Recover usage/cost state from prior turns so --budget enforcement survives restarts.
 * Fast path: read artifacts/usage.json if it exists (written atomically each turn).
 * Fallback: scan turn frontmatter for tokens_in/tokens_out/cost_usd fields.
 */
export async function recoverUsageState(session: Session): Promise<UsageEntry[]> {
  // Fast path: usage.json artifact contains the complete usage ledger
  try {
    const usagePath = join(session.dir, 'artifacts', 'usage.json');
    const raw = await readFile(usagePath, 'utf8');
    const artifact = JSON.parse(raw);
    if (Array.isArray(artifact.turns) && artifact.turns.length > 0) {
      return artifact.turns as UsageEntry[];
    }
  } catch {
    // No usage.json or invalid — fall through to turn scan
  }

  // Fallback: scan turn frontmatter
  const turnsDir = join(session.dir, 'turns');
  const turnFiles = await listTurnFiles(turnsDir);
  const entries: UsageEntry[] = [];

  for (const file of turnFiles) {
    try {
      const raw = await readFile(join(turnsDir, file), 'utf8');
      const parsed = validate(raw);
      if (!parsed.valid || !parsed.data) continue;
      const extra = parsed.data as Record<string, unknown>;
      const tokensIn = extra.tokens_in as number | null | undefined;
      const tokensOut = extra.tokens_out as number | null | undefined;
      const costUsd = extra.cost_usd as number | null | undefined;
      if (tokensIn != null || costUsd != null) {
        entries.push({
          turn: parsed.data.turn,
          from: parsed.data.from,
          model: (extra.model_name as string) ?? '',
          tokens_in: tokensIn ?? null,
          tokens_out: tokensOut ?? null,
          cost_usd: costUsd ?? null,
          duration_ms: (extra.duration_ms as number) ?? 0,
        });
      }
    } catch {
      // Skip unreadable turn files
    }
  }

  return entries;
}

// --- Status normalization ---

/**
 * Normalize agent-claimed status to orchestrator canonical status.
 * Prevents premature "done" when the session hasn't had enough turns.
 */
export function normalizeStatus(agentStatus: TurnStatus | string, turnCount: number, phase: string = 'plan'): string {
  // In implement phase, agents should only emit 'complete' — downgrade everything else
  if (phase === 'implement') {
    if (agentStatus === 'needs_human') return 'needs_human';
    return 'complete';
  }
  // In review phase, 'done' is legacy for 'decided + verdict:approve';
  // 'decided' passes through (verdict validated separately by orchestrator)
  if (phase === 'review') {
    if (agentStatus === 'done') return 'decided';
    if (agentStatus === 'decided') return 'decided';
    if (agentStatus === 'needs_human') return 'needs_human';
    return 'complete';
  }
  // Plan phase
  if (agentStatus === 'done' && turnCount < 2) return 'complete';
  if (agentStatus === 'done') return 'done';
  if (agentStatus === 'decided' && turnCount < 2) return 'complete';
  if (agentStatus === 'decided') return 'decided';
  if (agentStatus === 'needs_human') return 'needs_human';
  return 'complete';
}

// --- Agent invocation helpers ---

async function invokeOnce(agentName: string, session: Session, turnCount?: number, tracer?: Tracer, attemptCounters?: Map<string, number>, label?: string, tier?: ModelTier): Promise<InvokeOnceResult> {
  let attemptIdx = 0;
  if (turnCount !== undefined && attemptCounters) {
    const key = `${turnCount}-${agentName}`;
    attemptIdx = attemptCounters.get(key) ?? 0;
    attemptCounters.set(key, attemptIdx + 1);
  }
  const startMs = Date.now();

  if (tracer && turnCount !== undefined) {
    tracer.emit('attempt.start', { turn: turnCount, agent: agentName, phase: session.phase, data: { attempt_index: attemptIdx, label } });
  }

  const result = await invoke(agentName, { ...session, next_agent: agentName }, tier);
  const elapsedMs = Date.now() - startMs;
  const failed: boolean = result.timedOut || result.exitCode !== 0 || !result.output.trim();
  const reason: string = result.timedOut
    ? `timeout (${session.phase === 'implement' ? '900s' : '300s'})`
    : result.exitCode !== 0
      ? `exit code ${result.exitCode}`
      : 'empty output';

  // Save attempt artifact (prompt from runtime/prompt.md, full output)
  if (tracer && turnCount !== undefined) {
    let prompt = '';
    try {
      prompt = await readFile(join(session.dir, 'runtime', 'prompt.md'), 'utf8');
    } catch { /* prompt may not exist */ }

    const meta: AttemptMeta = {
      turn: turnCount,
      agent: agentName,
      attempt_index: attemptIdx,
      phase: session.phase,
      elapsed_ms: elapsedMs,
      exit_code: result.exitCode,
      timed_out: result.timedOut,
      cmd: agentName,
      cwd: session.target_repo,
    };

    const attemptDir = await tracer.saveAttempt(turnCount, agentName, attemptIdx, prompt, result.output, meta);
    tracer.emit('attempt.end', {
      turn: turnCount,
      agent: agentName,
      phase: session.phase,
      data: { attempt_dir: attemptDir, exit_code: result.exitCode, elapsed_ms: elapsedMs, timed_out: result.timedOut, ok: !failed },
    });
    return { ok: !failed, output: result.output, rawOutput: result.output, reason, attemptDir, usage: result.usage };
  }

  return { ok: !failed, output: result.output, rawOutput: result.output, reason, usage: result.usage };
}

async function invokeWithRetry(agentName: string, session: Session, turnCount: number, tracer: Tracer, attemptCounters: Map<string, number>, shouldAbort?: () => boolean, tier?: ModelTier): Promise<InvokeOnceResult & { effectiveTier?: ModelTier }> {
  let activity = ui.startActivity(turnCount, agentName, undefined, tier);
  let result: InvokeOnceResult = await invokeOnce(agentName, session, turnCount, tracer, attemptCounters, undefined, tier);
  activity.stop();
  let effectiveTier = tier;
  if (!result.ok && !shouldAbort?.()) {
    // Escalate non-full→full on invocation failure (same pattern as validation retry)
    const retryTier: ModelTier = tier !== 'full' ? 'full' : tier;
    if (tier !== 'full') {
      ui.status('invoke.escalate', { turn: turnCount, reason: result.reason });
    } else {
      ui.status('invoke.retry', { turn: turnCount, agent: agentName, reason: result.reason });
    }
    activity = ui.startActivity(turnCount, agentName, 'retry', retryTier);
    result = await invokeOnce(agentName, session, turnCount, tracer, attemptCounters, 'retry', retryTier);
    activity.stop();
    if (result.ok) effectiveTier = retryTier;
  }
  return { ...result, effectiveTier };
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

async function writeErrorTurn(session: Session, turnCount: number, agent: string, reason: string, rawOutput: string, modelTier?: ModelTier): Promise<void> {
  const id = `turn-${String(turnCount).padStart(4, '0')}-${agent}`;
  const data: CanonicalTurnData = {
    id,
    turn: turnCount,
    from: agent,
    timestamp: new Date().toISOString(),
    status: 'error',
    phase: session.phase,
  };
  if (modelTier) {
    data.model_tier = modelTier;
    try {
      data.model_name = resolveModelForParticipant(agent, session, modelTier);
    } catch {
      data.model_name = modelTier;
    }
  }
  // Sanitize rawOutput to prevent code fence escape
  const safeOutput = (rawOutput || '(empty)').replace(/```/g, '` ` `');
  const body = `## Error\n\n**Reason:** ${reason}\n\n### Raw Output\n\n\`\`\`\n${safeOutput}\n\`\`\``;
  await writeCanonicalTurn(session, id, data, body);
  ui.status('turn.error', { turn: turnCount, id });
}

async function writeHumanTurn(session: Session, turnCount: number, content: string): Promise<void> {
  const id = `turn-${String(turnCount).padStart(4, '0')}-human`;
  const data: CanonicalTurnData = {
    id,
    turn: turnCount,
    from: 'human',
    timestamp: new Date().toISOString(),
    status: 'complete',
    phase: session.phase,
  };
  await writeCanonicalTurn(session, id, data, content);
}

async function writeDiffArtifact(session: Session, turnCount: number, diff: string): Promise<void> {
  const artifactsDir: string = join(session.dir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const filename = `diff-${String(turnCount).padStart(4, '0')}.patch`;
  await atomicWrite(join(artifactsDir, filename), diff + '\n');
}

async function generatePlan(session: Session): Promise<void> {
  const turnsDir: string = join(session.dir, 'turns');
  const turnFiles: string[] = await listTurnFiles(turnsDir);
  if (turnFiles.length === 0) return;

  const planTurns: { turn: number; from: string; decisions: string[]; content: string }[] = [];
  for (const file of turnFiles) {
    const raw: string = await readFile(join(turnsDir, file), 'utf8');
    const parsed = validate(raw);
    if (!parsed.valid || !parsed.data) continue;
    // Only include plan-phase turns (phase may be 'plan' or legacy 'debate')
    const turnPhase = (parsed.data as Record<string, unknown>).phase as string | undefined;
    if (turnPhase && turnPhase !== 'plan' && turnPhase !== 'debate') continue;
    planTurns.push({
      turn: parsed.data.turn,
      from: parsed.data.from,
      decisions: parsed.data.decisions || [],
      content: parsed.content,
    });
  }

  if (planTurns.length === 0) return;

  const allDecisions = planTurns.flatMap(t => t.decisions);
  const lines: string[] = ['# Plan', ''];
  lines.push(`**Topic:** ${session.topic}`, '');

  if (allDecisions.length > 0) {
    lines.push('## Decisions', '');
    for (const d of allDecisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  lines.push('## Discussion Summary', '');
  for (const t of planTurns) {
    lines.push(`### Turn ${t.turn} (${t.from})`, '');
    // Include a truncated version of each turn's content
    const summary = t.content.length > 2000 ? t.content.slice(0, 2000) + '\n\n*[Truncated]*' : t.content;
    lines.push(summary, '');
  }

  const artifactsDir: string = join(session.dir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const planPath: string = join(artifactsDir, 'plan.md');
  await atomicWrite(planPath, lines.join('\n'));
  ui.status('artifact.plan', { path: planPath, turns: planTurns.length, decisions: allDecisions.length });
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
    ui.status('artifact.none', {});
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
  ui.status('artifact.decisions', { path: decisionsPath, count: decisions.length });
}

