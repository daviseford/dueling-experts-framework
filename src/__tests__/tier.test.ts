import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectModelTier } from '../orchestrator.js';

describe('selectModelTier', () => {
  it('returns "full" when noFast is true regardless of other signals', () => {
    assert.equal(selectModelTier('plan', true, 'claude', true), 'full');
    assert.equal(selectModelTier('plan', true, null, false), 'full');
  });

  it('returns "full" for implement phase', () => {
    assert.equal(selectModelTier('implement', false, 'claude', true), 'full');
  });

  it('returns "full" for review phase', () => {
    assert.equal(selectModelTier('review', false, 'claude', true), 'full');
  });

  it('returns "full" for plan phase with no signals', () => {
    assert.equal(selectModelTier('plan', false, null, false), 'full');
  });

  it('returns "fast" when pendingPlanDecided is set', () => {
    assert.equal(selectModelTier('plan', false, 'claude', false), 'fast');
    assert.equal(selectModelTier('plan', false, 'codex', false), 'fast');
  });

  it('returns "fast" when bothEverDecided is true', () => {
    assert.equal(selectModelTier('plan', false, null, true), 'fast');
  });

  it('returns "fast" when both signals are present (precedence test)', () => {
    assert.equal(selectModelTier('plan', false, 'claude', true), 'fast');
  });

  it('returns "full" when only one agent ever decided and no pending', () => {
    // This is the "gap state" — one agent decided before, consensus was contested,
    // and no new decided signal is pending. bothEverDecided is still false.
    assert.equal(selectModelTier('plan', false, null, false), 'full');
  });
});
