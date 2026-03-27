import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../cli.js';

describe('parseArgs', () => {
  it('parses --agents flag', () => {
    const opts = parseArgs(['--topic', 'test', '--agents', 'claude,codex']);
    assert.equal(opts.agents, 'claude,codex');
    assert.equal(opts.topic, 'test');
  });

  it('parses --agents with self-debate (same agent twice)', () => {
    const opts = parseArgs(['--topic', 'test', '--agents', 'claude,claude']);
    assert.equal(opts.agents, 'claude,claude');
  });

  it('parses --budget flag as a float', () => {
    const opts = parseArgs(['--topic', 'test', '--budget', '5.50']);
    assert.equal(opts.budget, 5.50);
  });

  it('parses --budget with integer value', () => {
    const opts = parseArgs(['--topic', 'test', '--budget', '10']);
    assert.equal(opts.budget, 10);
  });

  it('parses --dry-run flag', () => {
    const opts = parseArgs(['--topic', 'test', '--dry-run']);
    assert.equal(opts.dryRun, true);
  });

  it('parses all new flags together', () => {
    const opts = parseArgs([
      '--topic', 'refactor auth',
      '--agents', 'claude,claude',
      '--budget', '2.00',
      '--dry-run',
      '--no-fast',
    ]);
    assert.equal(opts.topic, 'refactor auth');
    assert.equal(opts.agents, 'claude,claude');
    assert.equal(opts.budget, 2.00);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.noFast, true);
  });

  it('does not set agents or budget when not provided', () => {
    const opts = parseArgs(['--topic', 'test']);
    assert.equal(opts.agents, undefined);
    assert.equal(opts.budget, undefined);
  });

  it('throws on unknown -- flags', () => {
    assert.throws(
      () => parseArgs(['--topic', 'test', '--maxturns', '5']),
      { message: /Unknown flag '--maxturns'/ },
    );
  });

  it('throws on unknown flag with helpful message', () => {
    assert.throws(
      () => parseArgs(['--unknown-flag']),
      { message: /Run 'def --help' for options/ },
    );
  });

  it('allows positional args without -- prefix', () => {
    const opts = parseArgs(['add', 'dark', 'mode']);
    assert.equal(opts.topic, 'add dark mode');
  });
});
