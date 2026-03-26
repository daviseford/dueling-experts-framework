import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from '../util.js';

describe('heartbeat.json format', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-heartbeat-${randomUUID()}`);
    await mkdir(sessionDir, { recursive: true });
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('writes valid JSON with heartbeat_at timestamp', async () => {
    const heartbeatPath = join(sessionDir, 'heartbeat.json');
    const payload = JSON.stringify({ heartbeat_at: new Date().toISOString() }) + '\n';
    await atomicWrite(heartbeatPath, payload);

    const raw = await readFile(heartbeatPath, 'utf8');
    const data = JSON.parse(raw);
    assert.ok(data.heartbeat_at, 'heartbeat_at should be present');
    // Verify it's a valid ISO date
    const date = new Date(data.heartbeat_at);
    assert.ok(!isNaN(date.getTime()), 'heartbeat_at should be a valid ISO date');
  });

  it('overwrites previous heartbeat atomically', async () => {
    const heartbeatPath = join(sessionDir, 'heartbeat.json');

    const first = new Date('2026-01-01T00:00:00.000Z').toISOString();
    await atomicWrite(heartbeatPath, JSON.stringify({ heartbeat_at: first }) + '\n');

    const second = new Date('2026-01-01T00:00:10.000Z').toISOString();
    await atomicWrite(heartbeatPath, JSON.stringify({ heartbeat_at: second }) + '\n');

    const raw = await readFile(heartbeatPath, 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.heartbeat_at, second, 'should contain the latest heartbeat');
  });
});
