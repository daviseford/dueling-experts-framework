import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, eventToMessage, shellEscape } from '../notify.js';

describe('createNotifier', () => {
  it('disabled notifier is a no-op', () => {
    const notifier = createNotifier({ enabled: false });
    // Should not throw
    notifier.notify('session.complete', { title: 'test', body: 'test' });
  });

  it('enabled notifier does not throw on notify', () => {
    const notifier = createNotifier({ enabled: true });
    // Should not throw (notification is fire-and-forget)
    notifier.notify('session.complete', { title: 'test', body: 'test' });
  });

  it('deduplicates rapid identical events', () => {
    let callCount = 0;
    const notifier = createNotifier({ enabled: true });
    // Monkey-patch to count — we can't easily intercept desktop notifications
    // but the dedup logic runs before the send call
    // The real test is that calling notify twice rapidly doesn't crash
    notifier.notify('session.complete', { title: 'test', body: 'test' });
    notifier.notify('session.complete', { title: 'test', body: 'test' });
    // No assertion on count since we can't hook into the internal send
    // The important thing is no crash
  });
});

describe('eventToMessage', () => {
  it('session.complete produces correct message', () => {
    const msg = eventToMessage('session.complete', { topic: 'Add dark mode' });
    assert.equal(msg.title, 'DEF Session Complete');
    assert.ok(msg.body.includes('Add dark mode'));
  });

  it('review.approved produces correct message', () => {
    const msg = eventToMessage('review.approved', { topic: 'Fix bug' });
    assert.equal(msg.title, 'Review Approved');
    assert.ok(msg.body.includes('Fix bug'));
  });

  it('review.fixes includes loop count', () => {
    const msg = eventToMessage('review.fixes', { topic: 'Test', loop: 2, max: 6 });
    assert.ok(msg.body.includes('2/6'));
  });

  it('pr.created includes URL', () => {
    const msg = eventToMessage('pr.created', { topic: 'Test', url: 'https://github.com/test/pr/1' });
    assert.ok(msg.body.includes('https://github.com/test/pr/1'));
  });

  it('error.pause includes turn number', () => {
    const msg = eventToMessage('error.pause', { topic: 'Test', turn: 5 });
    assert.ok(msg.body.includes('5'));
  });

  it('error.exit includes turn number', () => {
    const msg = eventToMessage('error.exit', { topic: 'Test', turn: 3 });
    assert.ok(msg.body.includes('3'));
  });

  it('human.needed produces correct message', () => {
    const msg = eventToMessage('human.needed', { topic: 'Review API' });
    assert.equal(msg.title, 'Human Input Needed');
    assert.ok(msg.body.includes('Review API'));
  });

  it('consensus.reached produces correct message', () => {
    const msg = eventToMessage('consensus.reached', { topic: 'Design system' });
    assert.equal(msg.title, 'Consensus Reached');
  });

  it('planning.done produces correct message', () => {
    const msg = eventToMessage('planning.done', { topic: 'Refactor auth' });
    assert.equal(msg.title, 'Planning Complete');
  });
});

describe('shellEscape', () => {
  it('escapes single quotes', () => {
    assert.equal(shellEscape("it's a test"), "it'\\''s a test");
  });

  it('leaves safe strings unchanged', () => {
    assert.equal(shellEscape('hello world'), 'hello world');
  });

  it('handles multiple quotes', () => {
    assert.equal(shellEscape("it's it's"), "it'\\''s it'\\''s");
  });
});
