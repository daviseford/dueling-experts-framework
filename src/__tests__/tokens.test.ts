import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTokenUsage } from '../agent.js';

describe('parseTokenUsage', () => {
  it('parses Claude CLI JSON with input/output tokens', () => {
    const stderr = 'Some debug output\n{"input_tokens": 1500, "output_tokens": 300}\nMore output';
    const usage = parseTokenUsage(stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 1500);
    assert.equal(usage!.output_tokens, 300);
  });

  it('parses Claude CLI JSON with cache tokens', () => {
    const stderr = '{"input_tokens": 2000, "output_tokens": 500, "cache_creation_input_tokens": 100, "cache_read_input_tokens": 800}';
    const usage = parseTokenUsage(stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 2000);
    assert.equal(usage!.output_tokens, 500);
    assert.equal(usage!.cache_creation_input_tokens, 100);
    assert.equal(usage!.cache_read_input_tokens, 800);
  });

  it('parses Codex CLI format', () => {
    const stderr = 'Completed: 1,234 input tokens, 567 output tokens used';
    const usage = parseTokenUsage(stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 1234);
    assert.equal(usage!.output_tokens, 567);
  });

  it('returns undefined for no token info', () => {
    const usage = parseTokenUsage('Just some regular stderr output');
    assert.equal(usage, undefined);
  });

  it('handles comma-formatted numbers in Codex format', () => {
    const stderr = '12,345 input tokens processed, 6,789 output tokens generated';
    const usage = parseTokenUsage(stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 12345);
    assert.equal(usage!.output_tokens, 6789);
  });

  it('handles malformed JSON gracefully', () => {
    const stderr = '{"input_tokens": not_a_number}';
    const usage = parseTokenUsage(stderr);
    assert.equal(usage, undefined);
  });

  it('parses only the first JSON object when stderr has multiple', () => {
    const stderr = '{"input_tokens": 100, "output_tokens": 50}\n{"input_tokens": 999, "output_tokens": 999}';
    const usage = parseTokenUsage(stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 100);
    assert.equal(usage!.output_tokens, 50);
  });
});
