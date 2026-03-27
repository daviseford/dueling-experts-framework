import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateDecisions } from '../orchestrator.js';
import type { DecisionEntry } from '../orchestrator.js';

describe('deduplicateDecisions', () => {
  it('preserves all entries when decisions are unique', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use React for the frontend' },
      { turn: 2, from: 'codex', decision: 'Use Postgres for persistence' },
      { turn: 3, from: 'claude', decision: 'Deploy via Docker' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 3);
    assert.deepStrictEqual(result, entries);
  });

  it('removes agreement-prefixed duplicate, keeping earliest turn', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use React' },
      { turn: 3, from: 'codex', decision: 'Agreed: use React' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0].turn, 1);
    assert.equal(result[0].from, 'claude');
    assert.equal(result[0].decision, 'Use React');
  });

  it('deduplicates case differences', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use react' },
      { turn: 2, from: 'codex', decision: 'use React' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0].turn, 1);
  });

  it('deduplicates trailing punctuation differences', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use React.' },
      { turn: 2, from: 'codex', decision: 'Use React' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0].turn, 1);
    assert.equal(result[0].decision, 'Use React.');
  });

  it('preserves both when suffixes differ despite shared prefix', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use React for routing' },
      { turn: 2, from: 'codex', decision: 'Agreed: use React for state management' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 2);
    assert.equal(result[0].decision, 'Use React for routing');
    assert.equal(result[1].decision, 'Agreed: use React for state management');
  });

  it('returns empty array for empty input', () => {
    const result = deduplicateDecisions([]);
    assert.deepStrictEqual(result, []);
  });

  it('drops decisions that normalize to empty string after prefix stripping', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use React' },
      { turn: 2, from: 'codex', decision: 'Agreed: .' },
      { turn: 3, from: 'claude', decision: 'Yes,' },
    ];
    const result = deduplicateDecisions(entries);
    // 'Agreed: .' normalizes to '' (empty after prefix strip + punctuation strip)
    // 'Yes,' normalizes to '' (prefix 'yes,' stripped, nothing left)
    assert.equal(result.length, 1);
    assert.equal(result[0].decision, 'Use React');
  });

  it('strips "Agreed --" prefix correctly (longest prefix first)', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Deploy to staging first' },
      { turn: 2, from: 'codex', decision: 'Agreed -- deploy to staging first' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0].turn, 1);
  });

  it('strips "Yes:" and "Yes --" prefixes', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use TypeScript' },
      { turn: 2, from: 'codex', decision: 'Yes: use TypeScript' },
      { turn: 3, from: 'claude', decision: 'Add unit tests' },
      { turn: 4, from: 'codex', decision: 'Yes -- add unit tests' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 2);
    assert.equal(result[0].decision, 'Use TypeScript');
    assert.equal(result[1].decision, 'Add unit tests');
  });

  it('collapses all duplicates to one entry (earliest turn)', () => {
    const entries: DecisionEntry[] = [
      { turn: 1, from: 'claude', decision: 'Use React' },
      { turn: 2, from: 'codex', decision: 'Agreed: use React' },
      { turn: 3, from: 'claude', decision: 'Confirmed: Use React.' },
      { turn: 4, from: 'codex', decision: 'Yes, use React!' },
    ];
    const result = deduplicateDecisions(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0].turn, 1);
    assert.equal(result[0].from, 'claude');
    assert.equal(result[0].decision, 'Use React');
  });
});
