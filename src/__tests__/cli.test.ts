import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../cli.js';

describe('parseArgs persona flags', () => {
  it('parses --persona-claude', () => {
    const result = parseArgs(['--topic', 'test', '--persona-claude', 'security.md']);
    assert.equal(result.personaClaude, 'security.md');
  });

  it('parses --persona-codex', () => {
    const result = parseArgs(['--topic', 'test', '--persona-codex', 'reviewer.md']);
    assert.equal(result.personaCodex, 'reviewer.md');
  });

  it('parses both persona flags together', () => {
    const result = parseArgs(['--topic', 'test', '--persona-claude', 'a.md', '--persona-codex', 'b.md']);
    assert.equal(result.personaClaude, 'a.md');
    assert.equal(result.personaCodex, 'b.md');
  });

  it('persona flags are undefined when not provided', () => {
    const result = parseArgs(['--topic', 'test']);
    assert.equal(result.personaClaude, undefined);
    assert.equal(result.personaCodex, undefined);
  });
});
