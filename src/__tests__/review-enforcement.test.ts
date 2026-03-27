import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrTitle } from '../orchestrator.js';

describe('buildPrTitle', () => {
  const topic = 'implement authentication flow';

  it('returns normal title when reviewApproved is true', () => {
    const title = buildPrTitle(topic, true);
    assert.equal(title, `def: ${topic}`);
  });

  it('prefixes with [UNAPPROVED] when review was not approved', () => {
    // Review never approved — e.g., review loop exhausted, or session ended early.
    const title = buildPrTitle(topic, false);
    assert.equal(title, `[UNAPPROVED] def: ${topic}`);
  });

  it('handles empty topic string', () => {
    assert.equal(buildPrTitle('', true), 'def: ');
    assert.equal(buildPrTitle('', false), '[UNAPPROVED] def: ');
  });

  it('handles topic with special characters', () => {
    const specialTopic = 'fix: "quotes" & <brackets>';
    assert.equal(buildPrTitle(specialTopic, true), `def: ${specialTopic}`);
    assert.equal(buildPrTitle(specialTopic, false), `[UNAPPROVED] def: ${specialTopic}`);
  });
});
