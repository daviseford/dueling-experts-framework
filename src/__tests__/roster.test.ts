import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster, buildDefaultRoster, getImplementer, getReviewer, getOtherParticipant, getParticipant } from '../roster.js';

describe('buildRoster', () => {
  it('builds a two-agent roster with correct roles', () => {
    const roster = buildRoster(['claude', 'codex'], 'claude');
    assert.equal(roster.length, 2);
    assert.equal(roster[0].id, 'claude');
    assert.equal(roster[0].provider, 'claude');
    assert.equal(roster[0].role, 'implementer');
    assert.equal(roster[0].displayName, 'Claude');
    assert.equal(roster[0].persona, undefined);
    assert.equal(roster[1].id, 'codex');
    assert.equal(roster[1].provider, 'codex');
    assert.equal(roster[1].role, 'reviewer');
    assert.equal(roster[1].displayName, 'Codex');
  });

  it('handles self-debate (duplicate providers) with unique IDs and personas', () => {
    const roster = buildRoster(['claude', 'claude'], 'claude');
    assert.equal(roster.length, 2);
    assert.equal(roster[0].id, 'claude-0');
    assert.equal(roster[1].id, 'claude-1');
    assert.equal(roster[0].provider, 'claude');
    assert.equal(roster[1].provider, 'claude');
    // Self-debate generates differentiated personas
    assert.ok(roster[0].persona);
    assert.ok(roster[1].persona);
    assert.notEqual(roster[0].persona, roster[1].persona);
    // Display names include Alpha/Beta suffix
    assert.ok(roster[0].displayName.includes('Alpha'));
    assert.ok(roster[1].displayName.includes('Beta'));
  });

  it('uses custom display names when provided', () => {
    const roster = buildRoster(['claude', 'codex'], 'claude', { claude: 'My Claude', codex: 'My Codex' });
    assert.equal(roster[0].displayName, 'My Claude');
    assert.equal(roster[1].displayName, 'My Codex');
  });

  it('assigns implementer role based on implModel', () => {
    const roster = buildRoster(['claude', 'codex'], 'codex');
    assert.equal(roster[0].role, 'reviewer');
    assert.equal(roster[1].role, 'implementer');
  });
});

describe('buildDefaultRoster', () => {
  it('derives second agent from the registry', () => {
    // Default registry has claude and codex
    const roster = buildDefaultRoster('claude', 'claude');
    assert.equal(roster.length, 2);
    // Second agent should be derived from registry (codex is the other registered provider)
    assert.equal(roster[1].provider, 'codex');
  });

  it('picks a different second agent when first is codex', () => {
    const roster = buildDefaultRoster('codex', 'codex');
    assert.equal(roster.length, 2);
    // First registered provider that is not 'codex' should be 'claude'
    assert.equal(roster[1].provider, 'claude');
  });
});

describe('roster query helpers', () => {
  const roster = buildRoster(['claude', 'codex'], 'claude');

  it('getImplementer returns the implementer', () => {
    const impl = getImplementer(roster);
    assert.equal(impl.id, 'claude');
    assert.equal(impl.role, 'implementer');
  });

  it('getReviewer returns the reviewer', () => {
    const rev = getReviewer(roster);
    assert.equal(rev.id, 'codex');
    assert.equal(rev.role, 'reviewer');
  });

  it('getOtherParticipant returns the other agent', () => {
    const other = getOtherParticipant(roster, 'claude');
    assert.equal(other.id, 'codex');
  });

  it('getParticipant finds by ID', () => {
    const p = getParticipant(roster, 'codex');
    assert.equal(p.provider, 'codex');
  });

  it('getParticipant throws for unknown ID', () => {
    assert.throws(() => getParticipant(roster, 'gemini'), /not found/);
  });
});
