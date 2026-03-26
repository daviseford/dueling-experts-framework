/**
 * src/ui.ts -- Single module owning all terminal formatting.
 *
 * API surface (slim by design):
 *   intro()           - gradient banner + session info
 *   status()          - typed event logging
 *   startActivity()   - spinner/ticker (absorbs old startTicker/stopTicker)
 *   outro()           - session-end summary
 *   warn()            - yellow warning
 *   error()           - red error
 */

import pc from 'picocolors';
import * as clack from '@clack/prompts';
import gradient from 'gradient-string';

// -- Environment detection ---------------------------------------------------

const isTTY = process.stdout.isTTY === true;
const noColor = !!process.env.NO_COLOR;

// -- Color helpers (respect NO_COLOR) ----------------------------------------

const c = noColor
  ? { dim: (s: string) => s, bold: (s: string) => s, cyan: (s: string) => s,
      green: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s,
      magenta: (s: string) => s, blue: (s: string) => s, gray: (s: string) => s,
      white: (s: string) => s, bgCyan: (s: string) => s, bgGreen: (s: string) => s,
      bgYellow: (s: string) => s, bgRed: (s: string) => s, bgMagenta: (s: string) => s }
  : pc;

// -- Symbols -----------------------------------------------------------------

const SYM = {
  bullet: '*',
  arrow: '->',
  check: '+',
  cross: 'x',
  warn: '!',
  info: 'i',
  bar: '|',
  dot: '.',
};

// -- Typed status events -----------------------------------------------------

interface StatusPayloads {
  'turn.written':       { turn: number; phase: string; tier: string; id: string; status: string };
  'turn.invalid':       { turn: number; preview: string; errors: string[] };
  'turn.retry':         { turn: number; reason?: string };
  'turn.synthesize':    { turn: number };
  'turn.error':         { turn: number; id: string };
  'turn.downgrade':     { turn: number; claimed: string };
  'tier.escalation':    { turn: number };
  'consensus.reached':  { turn: number };
  'consensus.pending':  { turn: number; agent: string; waiting: string };
  'consensus.contested':{ turn: number; agent: string };
  'phase.changed':      { from: string; to: string; turn?: number };
  'phase.planning.done':{ turn: number };
  'worktree.created':   { turn: number; branch: string };
  'diff.captured':      { turn: number };
  'changes.committed':  { turn: number };
  'no.changes':         { turn: number; attempt: number; max: number };
  'no.changes.limit':   { turn: number; max: number };
  'impl.to.review':     { turn: number };
  'review.approved':    { turn: number };
  'review.fixes':       { turn: number; loop: number; max: number };
  'review.limit':       { turn: number; max: number };
  'review.no.verdict':  { turn: number };
  'human.paused':       { turn: number };
  'human.exiting':      { turn: number };
  'human.auto.decided': { turn: number; agent: string };
  'human.resumed':      { turn: number };
  'interjection':       { turn: number };
  'interjection.dropped': { turn: number; count: number };
  'pr.created':         { url: string };
  'pr.skipped':         {};
  'artifact.plan':      { path: string; turns: number; decisions: number };
  'artifact.decisions': { path: string; count: number };
  'artifact.none':      {};
  'end.requested':      { turn: number };
  'error.pause':        { turn: number };
  'error.exit':         { turn: number };
  'recovery.approve':   {};
  'recovery.limit':     { max: number };
  'recovery.fix':       { loop: number; max: number };
  'invoke.retry':       { turn: number; agent: string; reason: string };
  'invoke.escalate':    { turn: number; reason: string };
  'server.url':         { url: string };
  'server.shared':      { port: number };
  'shutdown.start':     {};
  'shutdown.saved':     {};
  'shutdown.worktree':  { branch: string };
  'base.fallback':      { original: string; resolved: string };
  'base.unresolvable':  { original: string };
  'branch.switched':    { expected: string; actual: string };
  'push.failed':        { branch: string; error: string };
  'pr.failed':          { branch: string; error: string };
  'pr.parse.failed':    { output: string };
  'pr.lookup.failed':   { owner: string; repo: string; number: number };
}

type StatusEvent = keyof StatusPayloads;

// -- Badge helpers -----------------------------------------------------------

function phaseBadge(phase: string): string {
  switch (phase) {
    case 'plan':      return c.bgCyan(c.bold(` ${phase.toUpperCase()} `));
    case 'implement': return c.bgGreen(c.bold(` ${phase.toUpperCase()} `));
    case 'review':    return c.bgMagenta(c.bold(` ${phase.toUpperCase()} `));
    default:          return c.bold(`[${phase}]`);
  }
}

function tierBadge(tier: string): string {
  return tier === 'fast' ? c.dim(' [fast]') : '';
}

function turnPrefix(turn: number): string {
  return c.dim(`[Turn ${turn}]`);
}

// -- intro() -----------------------------------------------------------------

export interface SessionInfo {
  id: string;
  topic: string;
  mode: string;
  max_turns: number;
  next_agent: string;
  impl_model: string;
  review_turns: number;
  dir: string;
}

export function intro(session: SessionInfo): void {
  // Gradient banner (TTY + color only)
  if (isTTY && !noColor) {
    const warmGradient = gradient(['#FEDA75', '#FA7E1E', '#D62976', '#962FBF', '#4F5BD5']);
    const banner = warmGradient.multiline([
      '  ╔══════════════════════════════════════╗',
      '  ║   Dueling  Experts  Framework        ║',
      '  ╚══════════════════════════════════════╝',
    ].join('\n'));
    console.log('');
    console.log(banner);
  } else {
    console.log('');
    console.log('  Dueling Experts Framework');
  }

  // clack.intro for session title (TTY + color only)
  if (isTTY && !noColor) {
    clack.intro(c.bold(`Session ${session.id.slice(0, 8)}`));
  } else {
    console.log(`  Session ${session.id.slice(0, 8)}`);
  }

  // Session info block
  const kv = (key: string, val: string) =>
    `  ${c.cyan(key.padEnd(14))} ${c.white(c.bold(val))}`;

  console.log(kv('Topic', session.topic));
  console.log(kv('Mode', session.mode));
  console.log(kv('Max turns', String(session.max_turns)));
  console.log(kv('First agent', session.next_agent));
  console.log(kv('Impl model', session.impl_model));
  console.log(kv('Review turns', String(session.review_turns)));
  console.log(kv('Session dir', c.dim(session.dir)));
  console.log('');
}

// -- status() ----------------------------------------------------------------

export function status<E extends StatusEvent>(event: E, details: StatusPayloads[E]): void {
  const d = details as Record<string, unknown>;
  const msg = formatEvent(event, d);
  if (msg) console.log(msg);
}

function formatEvent(event: StatusEvent, d: Record<string, unknown>): string {
  switch (event) {
    // Turn lifecycle
    case 'turn.written': {
      const { turn, phase, tier, id, status: st } = d as StatusPayloads['turn.written'];
      return `${turnPrefix(turn)} ${phaseBadge(phase)}${tierBadge(tier)} ${c.green(SYM.check)} Written: ${c.cyan(id)} ${c.dim(`(${st})`)}`;
    }
    case 'turn.invalid': {
      const { turn, preview, errors } = d as StatusPayloads['turn.invalid'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} Invalid output: ${errors.join(', ')}. Preview: ${c.dim(preview)}`;
    }
    case 'turn.retry': {
      const { turn, reason } = d as StatusPayloads['turn.retry'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.arrow)} Retrying${reason ? `: ${reason}` : ''}...`;
    }
    case 'turn.synthesize': {
      const { turn } = d as StatusPayloads['turn.synthesize'];
      return `${turnPrefix(turn)} ${c.dim(SYM.info)} Synthesizing frontmatter for implement turn.`;
    }
    case 'turn.error': {
      const { turn, id } = d as StatusPayloads['turn.error'];
      return `${turnPrefix(turn)} ${c.red(SYM.cross)} Error turn written: ${c.red(id)}`;
    }
    case 'turn.downgrade': {
      const { turn, claimed } = d as StatusPayloads['turn.downgrade'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} Agent signaled ${c.bold(claimed)} too early -- downgrading to complete.`;
    }

    // Tier
    case 'tier.escalation': {
      const { turn } = d as StatusPayloads['tier.escalation'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.arrow)} Fast model failed validation. Retrying with full model...`;
    }

    // Consensus
    case 'consensus.reached': {
      const { turn } = d as StatusPayloads['consensus.reached'];
      return `${turnPrefix(turn)} ${c.green(SYM.check)} ${c.bold(c.green('Consensus reached.'))}`;
    }
    case 'consensus.pending': {
      const { turn, agent, waiting } = d as StatusPayloads['consensus.pending'];
      return `${turnPrefix(turn)} ${c.cyan(SYM.info)} ${c.bold(agent)} signals decided. Waiting for ${c.bold(waiting)} to confirm.`;
    }
    case 'consensus.contested': {
      const { turn, agent } = d as StatusPayloads['consensus.contested'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} ${c.bold(agent)} contests consensus. Resuming plan.`;
    }

    // Phase
    case 'phase.changed': {
      const { from, to } = d as StatusPayloads['phase.changed'];
      return `  ${c.dim(SYM.arrow)} Phase: ${phaseBadge(from)} ${c.dim(SYM.arrow)} ${phaseBadge(to)}`;
    }
    case 'phase.planning.done': {
      const { turn } = d as StatusPayloads['phase.planning.done'];
      return `${turnPrefix(turn)} ${c.green(SYM.check)} Planning mode -- session complete.`;
    }
    case 'worktree.created': {
      const { turn, branch } = d as StatusPayloads['worktree.created'];
      return `${turnPrefix(turn)} ${c.green(SYM.check)} Worktree created: ${c.cyan(branch)}`;
    }

    // Implementation
    case 'diff.captured': {
      const { turn } = d as StatusPayloads['diff.captured'];
      return `${turnPrefix(turn)} ${c.green(SYM.bullet)} Changes detected. Storing diff artifact.`;
    }
    case 'changes.committed': {
      const { turn } = d as StatusPayloads['changes.committed'];
      return `${turnPrefix(turn)} ${c.green(SYM.check)} Changes committed to branch.`;
    }
    case 'no.changes': {
      const { turn, attempt, max } = d as StatusPayloads['no.changes'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} No changes detected. Retrying implementation (${attempt}/${max})...`;
    }
    case 'no.changes.limit': {
      const { turn, max } = d as StatusPayloads['no.changes.limit'];
      return `${turnPrefix(turn)} ${c.red(SYM.cross)} No changes after ${max} attempts. Ending session.`;
    }
    case 'impl.to.review': {
      const { turn } = d as StatusPayloads['impl.to.review'];
      return `${turnPrefix(turn)} ${c.cyan(SYM.arrow)} Implementation complete. Transitioning to review.`;
    }

    // Review
    case 'review.approved': {
      const { turn } = d as StatusPayloads['review.approved'];
      return `${turnPrefix(turn)} ${c.green(SYM.check)} ${c.bold(c.green('Reviewer approved.'))} Session complete.`;
    }
    case 'review.fixes': {
      const { turn, loop, max } = d as StatusPayloads['review.fixes'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.arrow)} Reviewer requested fixes. Back to implement. ${c.dim(`(${loop}/${max})`)}`;
    }
    case 'review.limit': {
      const { turn, max } = d as StatusPayloads['review.limit'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} Review loop limit (${max}) reached. Ending session.`;
    }
    case 'review.no.verdict': {
      const { turn } = d as StatusPayloads['review.no.verdict'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} Review decided without verdict. Retrying...`;
    }

    // Human interaction
    case 'human.paused': {
      const { turn } = d as StatusPayloads['human.paused'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.info)} Agent needs human input. Paused.`;
    }
    case 'human.exiting': {
      const { turn } = d as StatusPayloads['human.exiting'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.info)} Agent needs human input. Exiting (no UI).`;
    }
    case 'human.auto.decided': {
      const { turn, agent } = d as StatusPayloads['human.auto.decided'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.arrow)} ${c.bold(agent)} requested human input during plan phase -- auto-advancing as decided.`;
    }
    case 'human.resumed': {
      const { turn } = d as StatusPayloads['human.resumed'];
      return `${turnPrefix(turn)} ${c.green(SYM.check)} Human input received.`;
    }
    case 'interjection': {
      const { turn } = d as StatusPayloads['interjection'];
      return `${turnPrefix(turn)} ${c.cyan(SYM.info)} Injected human interjection.`;
    }
    case 'interjection.dropped': {
      const { turn, count } = d as StatusPayloads['interjection.dropped'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} ${count} queued interjection(s) dropped (not in plan phase).`;
    }

    // PR
    case 'pr.created': {
      const { url } = d as StatusPayloads['pr.created'];
      return `  ${c.green(SYM.check)} PR created: ${c.cyan(c.bold(url))}`;
    }
    case 'pr.skipped':
      return `  ${c.dim(SYM.info)} No changes on branch -- skipping PR creation.`;

    // Artifacts
    case 'artifact.plan': {
      const { path, turns, decisions } = d as StatusPayloads['artifact.plan'];
      return `  ${c.green(SYM.check)} Plan artifact written: ${c.dim(path)} (${turns} turn(s), ${decisions} decision(s))`;
    }
    case 'artifact.decisions': {
      const { path, count } = d as StatusPayloads['artifact.decisions'];
      return `  ${c.green(SYM.check)} Decisions log written: ${c.dim(path)} (${count} decision(s))`;
    }
    case 'artifact.none':
      return `  ${c.dim(SYM.info)} No decisions found in turn frontmatter. Skipping decisions.md.`;

    // End / error
    case 'end.requested': {
      const { turn } = d as StatusPayloads['end.requested'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.info)} End requested. Stopping.`;
    }
    case 'error.pause': {
      const { turn } = d as StatusPayloads['error.pause'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.warn)} Paused after error. Waiting for human...`;
    }
    case 'error.exit': {
      const { turn } = d as StatusPayloads['error.exit'];
      return `${turnPrefix(turn)} ${c.red(SYM.cross)} Exiting after error.`;
    }

    // Recovery
    case 'recovery.approve':
      return `  ${c.cyan(SYM.info)} [Recovery] Reviewer approved before interruption. Finalizing session.`;
    case 'recovery.limit': {
      const { max } = d as StatusPayloads['recovery.limit'];
      return `  ${c.cyan(SYM.info)} [Recovery] Review loop limit (${max}) reached. Finalizing session.`;
    }
    case 'recovery.fix': {
      const { loop, max } = d as StatusPayloads['recovery.fix'];
      return `  ${c.cyan(SYM.info)} [Recovery] Applying pending fix verdict. Review loop ${loop}/${max}`;
    }

    // Invocation retries
    case 'invoke.retry': {
      const { turn, agent, reason } = d as StatusPayloads['invoke.retry'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.arrow)} ${agent} failed: ${reason}. Retrying...`;
    }
    case 'invoke.escalate': {
      const { turn, reason } = d as StatusPayloads['invoke.escalate'];
      return `${turnPrefix(turn)} ${c.yellow(SYM.arrow)} Fast model failed (${reason}). Escalating to full model...`;
    }

    // Server
    case 'server.url': {
      const { url } = d as StatusPayloads['server.url'];
      return `  ${c.cyan(SYM.info)} Watcher UI: ${c.cyan(c.bold(url))}`;
    }
    case 'server.shared': {
      const { port } = d as StatusPayloads['server.shared'];
      return `  ${c.cyan(SYM.info)} Shared server detected on port ${c.bold(String(port))}, running headless`;
    }

    // Shutdown
    case 'shutdown.start':
      return `\n${c.yellow(SYM.warn)} Shutting down gracefully...`;
    case 'shutdown.saved':
      return `  ${c.dim(SYM.check)} Uncommitted changes saved to branch.`;
    case 'shutdown.worktree': {
      const { branch } = d as StatusPayloads['shutdown.worktree'];
      return `  ${c.dim(SYM.check)} Worktree cleaned up. Branch preserved: ${c.cyan(branch)}`;
    }

    // Base ref resolution
    case 'base.fallback': {
      const { original, resolved } = d as StatusPayloads['base.fallback'];
      return `  ${c.yellow(SYM.warn)} Base ref ${c.cyan(original)} not found -- falling back to ${c.cyan(resolved)}`;
    }
    case 'base.unresolvable': {
      const { original } = d as StatusPayloads['base.unresolvable'];
      return `  ${c.yellow(SYM.warn)} Base ref ${c.cyan(original)} not found and no fallback resolved -- skipping PR.`;
    }
    case 'branch.switched': {
      const { expected, actual } = d as StatusPayloads['branch.switched'];
      return `  ${c.yellow(SYM.warn)} Agent switched from branch ${c.cyan(expected)} to ${c.cyan(actual)} -- changes may not be on the DEF branch.`;
    }

    // PR sub-events (from pr.ts)
    case 'push.failed': {
      const { branch, error: err } = d as StatusPayloads['push.failed'];
      return `  ${c.yellow(SYM.warn)} Could not push branch: ${err}. Branch preserved: ${c.cyan(branch)}`;
    }
    case 'pr.failed': {
      const { branch, error: err } = d as StatusPayloads['pr.failed'];
      return `  ${c.yellow(SYM.warn)} Could not create PR: ${err}. Branch preserved: ${c.cyan(branch)}`;
    }
    case 'pr.parse.failed': {
      const { output } = d as StatusPayloads['pr.parse.failed'];
      return `  ${c.yellow(SYM.warn)} Could not parse PR URL from gh output: ${output}`;
    }
    case 'pr.lookup.failed': {
      const { owner, repo, number: num } = d as StatusPayloads['pr.lookup.failed'];
      return `  ${c.yellow(SYM.warn)} Could not look up PR ${owner}/${repo}#${num} — falling back to current branch.`;
    }

    default:
      return '';
  }
}

// -- startActivity() / ActivityHandle ----------------------------------------

export interface ActivityHandle {
  stop(message?: string): void;
}

export function startActivity(turn: number, agent: string, label?: string, tier?: string): ActivityHandle {
  const tierTag = tier === 'fast' ? ' [fast]' : '';
  const prefix = label
    ? `${agent} ${label}`
    : `Invoking ${agent}`;
  const display = `[Turn ${turn}]${tierTag} ${prefix}`;

  // Fall back to plain text when not a TTY or when NO_COLOR is set
  if (!isTTY || noColor) {
    console.log(`${display}...`);
    return { stop() {} };
  }

  const s = clack.spinner();
  s.start(display);
  return {
    stop(message?: string) {
      s.stop(message ?? display);
    },
  };
}

// -- outro() -----------------------------------------------------------------

export interface SessionSummary {
  phase: string;
  branch?: string | null;
  pr?: string | null;
  turnsDir: string;
  artifactsDir: string;
}

export function outro(summary: SessionSummary): void {
  console.log('');

  const lines: string[] = [];
  lines.push(`${c.bold('Session completed.')}`);
  lines.push(`  ${c.dim('Phase')}     ${phaseBadge(summary.phase)}`);
  if (summary.branch) {
    lines.push(`  ${c.dim('Branch')}    ${c.cyan(summary.branch)}`);
  }
  if (summary.pr) {
    lines.push(`  ${c.dim('PR')}        ${c.cyan(c.bold(summary.pr))}`);
  }
  lines.push(`  ${c.dim('Turns')}     ${summary.turnsDir}`);
  lines.push(`  ${c.dim('Artifacts')} ${summary.artifactsDir}`);

  if (isTTY && !noColor) {
    clack.outro(lines.join('\n'));
  } else {
    for (const line of lines) {
      console.log(line);
    }
  }
}

// -- warn() / error() --------------------------------------------------------

export function warn(msg: string): void {
  console.log(`${c.yellow(SYM.warn)} ${c.yellow(msg)}`);
}

export function error(msg: string): void {
  console.log(`${c.red(SYM.cross)} ${c.red(msg)}`);
}
