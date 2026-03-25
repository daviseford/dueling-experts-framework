import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { confirmGate } from '../ui.js';

describe('confirmGate', () => {
  it('auto-approves in non-TTY mode', async () => {
    // Tests run in non-TTY mode, so confirmGate should auto-approve
    const result = await confirmGate('Test action?');
    assert.equal(result, true);
  });
});
