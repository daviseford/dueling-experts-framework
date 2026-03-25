import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../cli.js';

describe('parseArgs gate flags', () => {
  it('parses --dry-run', () => {
    const result = parseArgs(['--topic', 'test', '--dry-run']);
    assert.equal(result.dryRun, true);
  });

  it('parses --confirm-before-commit', () => {
    const result = parseArgs(['--topic', 'test', '--confirm-before-commit']);
    assert.equal(result.confirmBeforeCommit, true);
  });

  it('parses both flags together', () => {
    const result = parseArgs(['--topic', 'test', '--dry-run', '--confirm-before-commit']);
    assert.equal(result.dryRun, true);
    assert.equal(result.confirmBeforeCommit, true);
  });

  it('gate flags are undefined when not provided', () => {
    const result = parseArgs(['--topic', 'test']);
    assert.equal(result.dryRun, undefined);
    assert.equal(result.confirmBeforeCommit, undefined);
  });
});
