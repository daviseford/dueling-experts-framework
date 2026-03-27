import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectPreflightErrors, type CheckCommandFn } from '../preflight.js';

/**
 * Build a mock checkCommand that resolves true only for the given commands.
 * Commands are matched as "cmd args[0]" strings (e.g., "git rev-parse").
 */
function mockCheck(available: string[]): CheckCommandFn {
  return async (cmd: string, args?: string[]) => {
    const key = args ? `${cmd} ${args[0]}` : cmd;
    return available.some(a => key.startsWith(a));
  };
}

describe('collectPreflightErrors', () => {
  it('returns no errors when all checks pass', async () => {
    const check = mockCheck(['claude', 'codex', 'git rev-parse', 'git remote', 'gh --version', 'gh auth']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'edit' },
      check,
    );
    assert.equal(errors.length, 0);
  });

  it('reports missing agent CLI', async () => {
    const check = mockCheck(['claude', 'git rev-parse', 'git remote', 'gh --version', 'gh auth']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'edit' },
      check,
    );
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("'codex' CLI not found"));
  });

  it('reports not inside a git repo', async () => {
    const check = mockCheck(['claude', 'codex', 'git remote', 'gh --version', 'gh auth']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'edit' },
      check,
    );
    assert.ok(errors.some(e => e.includes('Not inside a git repository')));
  });

  it('reports missing origin remote in edit mode', async () => {
    const check = mockCheck(['claude', 'codex', 'git rev-parse', 'gh --version', 'gh auth']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'edit' },
      check,
    );
    assert.ok(errors.some(e => e.includes("No 'origin' remote")));
  });

  it('reports gh not installed in edit mode', async () => {
    const check = mockCheck(['claude', 'codex', 'git rev-parse', 'git remote']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'edit' },
      check,
    );
    assert.ok(errors.some(e => e.includes("'gh' CLI not found")));
  });

  it('reports gh not authenticated in edit mode', async () => {
    const check = mockCheck(['claude', 'codex', 'git rev-parse', 'git remote', 'gh --version']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'edit' },
      check,
    );
    assert.ok(errors.some(e => e.includes('GitHub CLI not authenticated')));
  });

  it('skips gh and remote checks when noPr is true', async () => {
    const check = mockCheck(['claude', 'codex', 'git rev-parse']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: true, mode: 'edit' },
      check,
    );
    assert.equal(errors.length, 0);
  });

  it('skips gh and remote checks in planning mode', async () => {
    const check = mockCheck(['claude', 'codex', 'git rev-parse']);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'planning' },
      check,
    );
    assert.equal(errors.length, 0);
  });

  it('collects multiple errors at once', async () => {
    // Nothing is available
    const check = mockCheck([]);
    const errors = await collectPreflightErrors(
      { agents: ['claude', 'codex'], noPr: false, mode: 'edit' },
      check,
    );
    // claude missing, codex missing, not in git repo (remote + gh skipped since not in git repo)
    assert.equal(errors.length, 3);
  });

  it('deduplicates providers', async () => {
    // Self-debate: claude,claude -- should only check claude CLI once
    let checkCount = 0;
    const check: CheckCommandFn = async (cmd: string, args?: string[]) => {
      if (cmd === 'claude' && !args) checkCount++;
      return true;
    };
    await collectPreflightErrors(
      { agents: ['claude', 'claude'], noPr: true, mode: 'edit' },
      check,
    );
    assert.equal(checkCount, 1);
  });
});
