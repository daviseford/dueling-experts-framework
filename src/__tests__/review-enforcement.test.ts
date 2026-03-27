import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrTitle } from '../orchestrator.js';

describe('buildPrTitle', () => {
  const topic = 'implement authentication flow';

  it('returns normal title when reviewApproved is true', () => {
    const title = buildPrTitle(topic, true, false);
    assert.equal(title, `def: ${topic}`);
  });

  it('returns normal title when reviewApproved is true and endRequested is also true', () => {
    // Both flags set (e.g., recovery after approve + user end) — no prefix.
    const title = buildPrTitle(topic, true, true);
    assert.equal(title, `def: ${topic}`);
  });

  it('returns normal title when endRequested is true (user override)', () => {
    // User explicitly ended the session without review approval.
    const title = buildPrTitle(topic, false, true);
    assert.equal(title, `def: ${topic}`);
  });

  it('prefixes with [UNAPPROVED] when neither approved nor user-ended', () => {
    // Review never approved and user did not explicitly end — e.g., review loop exhausted.
    const title = buildPrTitle(topic, false, false);
    assert.equal(title, `[UNAPPROVED] def: ${topic}`);
  });

  it('handles empty topic string', () => {
    assert.equal(buildPrTitle('', true, false), 'def: ');
    assert.equal(buildPrTitle('', false, false), '[UNAPPROVED] def: ');
  });

  it('handles topic with special characters', () => {
    const specialTopic = 'fix: "quotes" & <brackets>';
    assert.equal(buildPrTitle(specialTopic, true, false), `def: ${specialTopic}`);
    assert.equal(buildPrTitle(specialTopic, false, false), `[UNAPPROVED] def: ${specialTopic}`);
  });
});
