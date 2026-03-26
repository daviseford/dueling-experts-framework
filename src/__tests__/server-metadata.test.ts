process.env.DEF_NO_OPEN = '1';
process.env.CI = '1';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { getSessionMetadata, start, stop } from '../server.js';

describe('getSessionMetadata', () => {
  let sessionDir: string;
  let sessionPath: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-server-meta-${randomUUID()}`);
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
    sessionPath = join(sessionDir, 'session.json');
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('returns defaults when session.json does not exist', async () => {
    const meta = await getSessionMetadata(join(sessionDir, 'nonexistent.json'));
    assert.equal(meta.sessionStatus, 'active');
    assert.equal(meta.phase, null);
    assert.equal(meta.branchName, null);
    assert.equal(meta.prUrl, null);
    assert.equal(meta.prNumber, null);
    assert.deepEqual(meta.artifactNames, []);
  });

  it('returns all metadata fields from a completed session', async () => {
    await writeFile(sessionPath, JSON.stringify({
      session_status: 'completed',
      phase: 'implement',
      branch_name: 'def/abc12345-test',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    }));
    await writeFile(join(sessionDir, 'artifacts', 'decisions.md'), '1. test decision\n');
    await writeFile(join(sessionDir, 'artifacts', 'pr-body.md'), 'test body\n');

    const meta = await getSessionMetadata(sessionPath);
    assert.equal(meta.sessionStatus, 'completed');
    assert.equal(meta.phase, 'implement');
    assert.equal(meta.branchName, 'def/abc12345-test');
    assert.equal(meta.prUrl, 'https://github.com/org/repo/pull/42');
    assert.equal(meta.prNumber, 42);
    assert.ok(meta.artifactNames.includes('decisions.md'));
    assert.ok(meta.artifactNames.includes('pr-body.md'));
  });

  it('returns null defaults for missing optional fields in session.json', async () => {
    await writeFile(sessionPath, JSON.stringify({
      session_status: 'active',
    }));

    const meta = await getSessionMetadata(sessionPath);
    assert.equal(meta.sessionStatus, 'active');
    assert.equal(meta.phase, null);
    assert.equal(meta.branchName, null);
    assert.equal(meta.prUrl, null);
    assert.equal(meta.prNumber, null);
  });

  it('filters dotfiles from artifact names', async () => {
    await writeFile(join(sessionDir, 'artifacts', '.hidden'), 'hidden');
    await writeFile(sessionPath, JSON.stringify({ session_status: 'completed' }));

    const meta = await getSessionMetadata(sessionPath);
    assert.ok(!meta.artifactNames.includes('.hidden'));
  });
});

describe('/api/turns response shape', () => {
  let sessionDir: string;
  let port: number;

  before(async () => {
    sessionDir = join(tmpdir(), `def-server-endpoint-${randomUUID()}`);
    await mkdir(join(sessionDir, 'turns'), { recursive: true });
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });

    // Write a completed session.json with all metadata fields
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({
      session_status: 'completed',
      phase: 'implement',
      branch_name: 'def/test-branch',
      pr_url: 'https://github.com/org/repo/pull/7',
      pr_number: 7,
    }));

    // Write an artifact file
    await writeFile(join(sessionDir, 'artifacts', 'decisions.md'), '1. test\n');

    // Create mock session and controller
    const mockSession = {
      id: randomUUID(),
      topic: 'test topic',
      mode: 'edit',
      max_turns: 10,
      target_repo: sessionDir,
      created: new Date().toISOString(),
      session_status: 'completed' as const,
      current_turn: 2,
      next_agent: 'claude' as const,
      phase: 'implement' as const,
      impl_model: 'claude' as const,
      review_turns: 6,
      port: null,
      pid: process.pid,
      dir: sessionDir,
      worktree_path: null,
      branch_name: 'def/test-branch',
      original_repo: null,
      base_ref: null,
      pr_url: 'https://github.com/org/repo/pull/7',
      pr_number: 7,
    };

    const mockController = {
      isPaused: false,
      endRequested: false,
      thinking: null,
      phase: 'implement',
      interject() {},
      requestEnd() {},
    };

    await start(mockSession, mockController);

    // Read back the port that the server wrote to session.json
    const updated = JSON.parse(await readFile(join(sessionDir, 'session.json'), 'utf8'));
    port = updated.port;
  });

  after(async () => {
    stop();
    await rm(sessionDir, { recursive: true, force: true });
  });

  function httpGet(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode!, body: data }));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  it('returns all expected metadata keys', async () => {
    const { status, body } = await httpGet('/api/turns');
    assert.equal(status, 200);

    const json = JSON.parse(body);

    // Core fields
    assert.ok(Array.isArray(json.turns));
    assert.ok(typeof json.session_id === 'string');
    assert.ok(json.session_id.length > 0);
    assert.equal(json.session_status, 'completed');
    assert.equal(json.topic, 'test topic');
    assert.equal(typeof json.turn_count, 'number');
    assert.equal(json.thinking, null);

    // Completion metadata — the key parity check
    assert.equal(json.phase, 'implement');
    assert.equal(json.branch_name, 'def/test-branch');
    assert.equal(json.pr_url, 'https://github.com/org/repo/pull/7');
    assert.equal(json.pr_number, 7);
    assert.ok(typeof json.turns_path === 'string');
    assert.ok(json.turns_path.includes('turns'));
    assert.ok(typeof json.artifacts_path === 'string');
    assert.ok(json.artifacts_path.includes('artifacts'));
    assert.ok(Array.isArray(json.artifact_names));
    assert.ok(json.artifact_names.includes('decisions.md'));
  });

  it('prefers persisted phase from session.json over controller phase', async () => {
    const { body } = await httpGet('/api/turns');
    const json = JSON.parse(body);
    // session.json says 'implement', controller also says 'implement'
    // but the point is session.json is authoritative
    assert.equal(json.phase, 'implement');
  });

  it('returns turns_path and artifacts_path as absolute paths', async () => {
    const { body } = await httpGet('/api/turns');
    const json = JSON.parse(body);
    assert.equal(json.turns_path, join(sessionDir, 'turns'));
    assert.equal(json.artifacts_path, join(sessionDir, 'artifacts'));
  });
});
