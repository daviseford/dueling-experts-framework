import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus } from '../orchestrator.js';

describe('normalizeStatus', () => {
  it('downgrades "done" on turn 1 to "complete"', () => {
    assert.equal(normalizeStatus('done', 1), 'complete');
  });

  it('allows "done" on turn 2+', () => {
    assert.equal(normalizeStatus('done', 2), 'done');
    assert.equal(normalizeStatus('done', 10), 'done');
  });

  it('passes through "needs_human"', () => {
    assert.equal(normalizeStatus('needs_human', 1), 'needs_human');
    assert.equal(normalizeStatus('needs_human', 5), 'needs_human');
  });

  it('defaults unknown statuses to "complete"', () => {
    assert.equal(normalizeStatus('complete', 1), 'complete');
    assert.equal(normalizeStatus('garbage', 3), 'complete');
    assert.equal(normalizeStatus(undefined, 1), 'complete');
  });
});
