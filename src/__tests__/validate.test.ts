import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../validation.js';

describe('validate', () => {
  const validTurn = [
    '---',
    'id: turn-0001-claude',
    'turn: 1',
    'from: claude',
    'timestamp: 2026-03-23T14:30:00.000Z',
    'status: complete',
    '---',
    'Hello world',
  ].join('\n');

  it('parses valid frontmatter', () => {
    const result = validate(validTurn);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.data!.from, 'claude');
    assert.equal(result.data!.status, 'complete');
    assert.equal(result.content, 'Hello world');
  });

  it('rejects missing frontmatter', () => {
    const result = validate('No frontmatter here');
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('No YAML frontmatter'));
  });

  it('rejects invalid status', () => {
    const raw = validTurn.replace('status: complete', 'status: invalid');
    const result = validate(raw);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid status')));
  });

  it('accepts any non-empty from (dynamic agent names)', () => {
    const raw = validTurn.replace('from: claude', 'from: gpt4');
    const result = validate(raw);
    assert.equal(result.valid, true);
    assert.equal(result.data!.from, 'gpt4');
  });

  it('accepts decided status', () => {
    const raw = validTurn.replace('status: complete', 'status: decided');
    const result = validate(raw);
    assert.equal(result.valid, true);
    assert.equal(result.data!.status, 'decided');
  });

  it('validates decisions as array of strings', () => {
    const withDecisions = validTurn.replace('status: complete', 'status: complete\ndecisions:\n  - Use polling\n  - Add tests');
    const result = validate(withDecisions);
    assert.equal(result.valid, true);
    assert.deepEqual(result.data!.decisions, ['Use polling', 'Add tests']);
  });

  it('coerces YAML-parsed decision objects to strings', () => {
    const raw = [
      '---',
      'id: turn-0001-claude',
      'turn: 1',
      'from: claude',
      'timestamp: 2026-03-23T14:30:00.000Z',
      'status: complete',
      'decisions:',
      '  - Plan agreed: use release-please for versioning',
      '  - Normal string decision',
      '---',
      'body',
    ].join('\n');
    const result = validate(raw);
    assert.equal(result.valid, true);
    assert.equal(result.data!.decisions!.length, 2);
    assert.equal(typeof result.data!.decisions![0], 'string');
    assert.ok(result.data!.decisions![0].includes('Plan agreed'));
    assert.equal(result.data!.decisions![1], 'Normal string decision');
  });

  it('extracts frontmatter preceded by preamble text', () => {
    const withPreamble = 'Here is some preamble text\n\n' + validTurn;
    const result = validate(withPreamble);
    assert.equal(result.valid, true);
    assert.equal(result.data!.from, 'claude');
  });

  it('recovers from decisions with YAML-breaking colons and backticks', () => {
    const raw = [
      '---',
      'id: turn-0001-claude',
      'turn: 1',
      'from: claude',
      'timestamp: 2026-03-23T14:30:00.000Z',
      'status: complete',
      'decisions:',
      "  - Keep `session_status: 'paused'` for live in-process human wait",
      '  - Remove recovery.ts and --resume flag entirely',
      '---',
      'body',
    ].join('\n');
    const result = validate(raw);
    assert.equal(result.valid, true, `Expected valid but got errors: ${result.errors.join(', ')}`);
    assert.equal(result.data!.decisions!.length, 2);
    assert.ok(result.data!.decisions![0].includes('session_status'));
    assert.ok(result.data!.decisions![1].includes('recovery'));
  });

  it('rejects missing required fields', () => {
    const raw = ['---', 'from: claude', 'status: complete', '---', 'body'].join('\n');
    const result = validate(raw);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Missing required field')));
  });

  it('accepts valid verdict field', () => {
    const raw = validTurn.replace('status: complete', 'status: decided\nverdict: approve');
    const result = validate(raw);
    assert.equal(result.valid, true);
    assert.equal(result.data!.verdict, 'approve');
  });

  it('accepts fix verdict', () => {
    const raw = validTurn.replace('status: complete', 'status: decided\nverdict: fix');
    const result = validate(raw);
    assert.equal(result.valid, true);
    assert.equal(result.data!.verdict, 'fix');
  });

  it('rejects invalid verdict', () => {
    const raw = validTurn.replace('status: complete', 'status: decided\nverdict: reject');
    const result = validate(raw);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid verdict')));
  });

  it('allows missing verdict field', () => {
    const raw = validTurn.replace('status: complete', 'status: decided');
    const result = validate(raw);
    assert.equal(result.valid, true);
    assert.equal(result.data!.verdict, undefined);
  });
});
