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

  it('parses all new flags together', () => {
    const opts = parseArgs([
      '--topic', 'refactor auth',
      '--agents', 'claude,claude',
      '--no-fast',
    ]);
    assert.equal(opts.topic, 'refactor auth');
    assert.equal(opts.agents, 'claude,claude');
    assert.equal(opts.noFast, true);
  });

  it('does not set agents when not provided', () => {
    const opts = parseArgs(['--topic', 'test']);
    assert.equal(opts.agents, undefined);
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
      { message: /Run 'def' with no arguments for usage/ },
    );
  });

  it('parses --help flag', () => {
    const opts = parseArgs(['--help']);
    assert.equal(opts.help, true);
  });

  it('parses -h flag', () => {
    const opts = parseArgs(['-h']);
    assert.equal(opts.help, true);
  });

  it('allows positional args without -- prefix', () => {
    const opts = parseArgs(['add', 'dark', 'mode']);
    assert.equal(opts.topic, 'add dark mode');
  });
});
