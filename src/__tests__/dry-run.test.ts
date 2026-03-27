import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster } from '../roster.js';
import { dryRunPreview } from '../ui.js';

describe('dryRunPreview', () => {
  it('renders planning participants, roles, and edit side effects', () => {
    const preview = dryRunPreview({
      topic: 'add dry run preview',
      mode: 'edit',
      targetRepo: 'D:\\Projects\\dueling-experts-framework',
      maxTurns: 20,
      reviewTurns: 6,
      roster: buildRoster(['claude', 'codex'], 'claude', {
        claude: 'Claude',
        codex: 'Codex',
      }),
      noPr: false,
      noWorktree: false,
      budget: 5,
    });

    assert.match(preview, /Dueling Experts Framework -- Dry Run/);
    assert.match(preview, /Planning participants/);
    assert.match(preview, /claude \(Claude\)/);
    assert.match(preview, /codex \(Codex\)/);
    assert.match(preview, /Implementer\s+claude \(Claude\)/);
    assert.match(preview, /Reviewer\s+codex \(Codex\)/);
    assert.match(preview, /1\. Plan\s+2 agent\(s\) debate until consensus/);
    assert.match(preview, /2\. Implement claude makes changes in the isolated work area\./);
    assert.match(preview, /3\. Review\s+codex reviews and may request fixes for up to 6 review turn\(s\)\./);
    assert.match(preview, /git worktree and dedicated branch would be created/);
    assert.match(preview, /draft GitHub PR would be opened/);
    assert.match(preview, /Budget cap: \$5\.00/);
    assert.match(preview, /--dry-run exits before preflight checks, session creation, server setup, or agent invocation\./);
  });

  it('renders planning mode without edit side effects', () => {
    const preview = dryRunPreview({
      topic: 'plan only',
      mode: 'planning',
      targetRepo: 'D:\\Projects\\dueling-experts-framework',
      maxTurns: 8,
      reviewTurns: 4,
      roster: buildRoster(['claude', 'claude'], 'claude', {
        claude: 'Claude',
      }),
      noPr: true,
      noWorktree: true,
    });

    assert.match(preview, /First planner\s+claude-0 \(Claude \(Alpha\)\)/);
    assert.match(preview, /2\. End\s+Planning mode stops after the plan phase\./);
    assert.match(preview, /Planning mode would stop after writing plan artifacts; no code changes or PRs\./);
    assert.match(preview, /No budget cap set\. Use --budget <usd> to limit spending\./);
  });
});
