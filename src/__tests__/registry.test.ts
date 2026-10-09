import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

// registerRepo/listKnownRepos use a global path (~/.def/known-repos) fixed at
// import time, so they run in child processes with HOME pointed at a temp dir.
// listSessions augmentation is tested in history.test.ts.

describe('registry module exports', () => {
  it('imports without error', async () => {
    const mod = await import('../registry.js');
    assert.equal(typeof mod.registerRepo, 'function');
    assert.equal(typeof mod.listKnownRepos, 'function');
    assert.equal(typeof mod.listAllSessions, 'function');
  });
});

describe('registry concurrency', () => {
  const registryUrl = pathToFileURL(fileURLToPath(new URL('../registry.ts', import.meta.url))).href;
  let home: string;

  before(async () => {
    home = join(tmpdir(), `def-registry-test-${randomUUID()}`);
    await mkdir(home, { recursive: true });
  });

  after(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // Each child process waits on stdin until every child is ready, then runs its
  // registerRepo calls concurrently. HOME/USERPROFILE point ~/.def at the temp dir.
  function startChild(paths: string[]) {
    const code = `
      const { registerRepo, listKnownRepos } = await import(${JSON.stringify(registryUrl)});
      const paths = ${JSON.stringify(paths)};
      process.stdout.write('ready\\n');
      process.stdin.once('data', async () => {
        await Promise.all(paths.map((p) => registerRepo(p)));
        process.stdout.write(JSON.stringify(await listKnownRepos()) + '\\n');
        process.exit(0);
      });`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    const ready = new Promise<void>((resolve) => {
      child.stdout.on('data', (d) => { out += d; if (out.includes('ready\n')) resolve(); });
    });
    const done = new Promise<string>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve(out.split('\n')[1]) : reject(new Error(`child exited ${code}`))));
    });
    return { child, ready, done };
  }

  it('keeps every repo when separate processes register at the same time', async () => {
    const groups = [0, 1, 2, 3].map((g) =>
      Array.from({ length: 10 }, (_, i) => join(home, `repo-${g}-${i}`)),
    );
    // Same repo in every process: must still be listed once.
    const shared = join(home, 'repo-shared');
    for (const g of groups) g.push(shared);
    for (const p of groups.flat()) await mkdir(join(p, '.def', 'sessions'), { recursive: true });

    const children = groups.map(startChild);
    await Promise.all(children.map((c) => c.ready));
    for (const c of children) c.child.stdin.end('go\n');
    await Promise.all(children.map((c) => c.done));

    const expected = [...new Set(groups.flat())].sort();
    const raw = await readFile(join(home, '.def', 'known-repos'), 'utf8');
    assert.deepEqual([...new Set(raw.split('\n').filter(Boolean))].sort(), expected);

    // listKnownRepos (read after all writers finished) returns each repo once.
    const final = startChild([]);
    await final.ready;
    final.child.stdin.end('go\n');
    assert.deepEqual(JSON.parse(await final.done).sort(), expected);
  });

  it('starts a new line when the file lacks a trailing newline', async () => {
    const a = join(home, 'edge-a');
    const b = join(home, 'edge-b');
    for (const p of [a, b]) await mkdir(join(p, '.def', 'sessions'), { recursive: true });
    await mkdir(join(home, '.def'), { recursive: true });
    await writeFile(join(home, '.def', 'known-repos'), a, 'utf8');

    const c = startChild([b]);
    await c.ready;
    c.child.stdin.end('go\n');
    assert.deepEqual(JSON.parse(await c.done), [a, b]);
  });
});
