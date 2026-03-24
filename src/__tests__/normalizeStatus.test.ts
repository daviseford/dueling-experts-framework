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

  it('downgrades "decided" on turn 1 to "complete"', () => {
    assert.equal(normalizeStatus('decided', 1), 'complete');
  });

  it('allows "decided" on turn 2+', () => {
    assert.equal(normalizeStatus('decided', 2), 'decided');
    assert.equal(normalizeStatus('decided', 5), 'decided');
  });

  it('defaults unknown statuses to "complete"', () => {
    assert.equal(normalizeStatus('complete', 1), 'complete');
    assert.equal(normalizeStatus('garbage', 3), 'complete');
    assert.equal(normalizeStatus(undefined as unknown as string, 1), 'complete');
  });

  it('downgrades "done" to "complete" in implement phase', () => {
    assert.equal(normalizeStatus('done', 5, 'implement'), 'complete');
  });

  it('downgrades "decided" to "complete" in implement phase', () => {
    assert.equal(normalizeStatus('decided', 5, 'implement'), 'complete');
  });

  it('allows "needs_human" in implement phase', () => {
    assert.equal(normalizeStatus('needs_human', 5, 'implement'), 'needs_human');
  });

  // Review phase tests
  it('maps "done" to "decided" in review phase (legacy compat)', () => {
    assert.equal(normalizeStatus('done', 5, 'review'), 'decided');
  });

  it('allows "decided" in review phase', () => {
    assert.equal(normalizeStatus('decided', 5, 'review'), 'decided');
  });

  it('allows "needs_human" in review phase', () => {
    assert.equal(normalizeStatus('needs_human', 5, 'review'), 'needs_human');
  });

  it('defaults unknown statuses to "complete" in review phase', () => {
    assert.equal(normalizeStatus('complete', 5, 'review'), 'complete');
    assert.equal(normalizeStatus('garbage', 5, 'review'), 'complete');
  });
});
