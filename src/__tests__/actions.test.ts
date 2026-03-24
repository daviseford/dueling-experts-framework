import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseActions, executeActions } from '../actions.js';

describe('parseActions', () => {
  it('parses a write-file action', () => {
    const content = [
      'Some preamble text.',
      '',
      '```def-action',
      'type: write-file',
      'path: src/foo.js',
      '---',
      'const x = 1;',
      '```',
    ].join('\n');

    const actions = parseActions(content);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'write-file');
    assert.equal(actions[0].path, 'src/foo.js');
    assert.equal(actions[0].body, 'const x = 1;');
  });

  it('parses an edit-file action', () => {
    const content = [
      '```def-action',
      'type: edit-file',
      'path: src/foo.js',
      'search: const x = 1;',
      '---',
      'const x = 2;',
      '```',
    ].join('\n');

    const actions = parseActions(content);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'edit-file');
    assert.equal(actions[0].search, 'const x = 1;');
    assert.equal(actions[0].body, 'const x = 2;');
  });

  it('parses a shell action', () => {
    const content = [
      '```def-action',
      'type: shell',
      'cmd: npm test',
      'cwd: .',
      '```',
    ].join('\n');

    const actions = parseActions(content);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'shell');
    assert.equal(actions[0].cmd, 'npm test');
    assert.equal(actions[0].cwd, '.');
  });

  it('parses a mkdir action', () => {
    const content = [
      '```def-action',
      'type: mkdir',
      'path: src/new-dir',
      '```',
    ].join('\n');

    const actions = parseActions(content);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'mkdir');
    assert.equal(actions[0].path, 'src/new-dir');
  });

  it('parses multiple actions', () => {
    const content = [
      '```def-action',
      'type: mkdir',
      'path: src/lib',
      '```',
      '',
      '```def-action',
      'type: write-file',
      'path: src/lib/util.js',
      '---',
      'export default {};',
      '```',
    ].join('\n');

    const actions = parseActions(content);
    assert.equal(actions.length, 2);
    assert.equal(actions[0].type, 'mkdir');
    assert.equal(actions[1].type, 'write-file');
  });

  it('returns empty array when no action blocks', () => {
    const content = 'Just some regular markdown\n\n```js\nconsole.log("hi");\n```';
    assert.deepEqual(parseActions(content), []);
  });

  it('skips blocks without a type', () => {
    const content = '```def-action\npath: foo\n```';
    assert.deepEqual(parseActions(content), []);
  });
});

describe('executeActions', () => {
  let tmpDir: string | undefined;

  async function makeTmp(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), 'def-actions-test-'));
    return tmpDir;
  }

  async function cleanTmp() {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }

  it('write-file creates a file', async () => {
    const repo = await makeTmp();
    try {
      const results = await executeActions(
        [{ type: 'write-file', path: 'hello.txt', body: 'hello world' }],
        repo,
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].ok, true);
      const content = await readFile(join(repo, 'hello.txt'), 'utf8');
      assert.equal(content, 'hello world');
    } finally {
      await cleanTmp();
    }
  });

  it('write-file creates nested directories', async () => {
    const repo = await makeTmp();
    try {
      const results = await executeActions(
        [{ type: 'write-file', path: 'a/b/c.txt', body: 'nested' }],
        repo,
      );
      assert.equal(results[0].ok, true);
      const content = await readFile(join(repo, 'a', 'b', 'c.txt'), 'utf8');
      assert.equal(content, 'nested');
    } finally {
      await cleanTmp();
    }
  });

  it('edit-file replaces content', async () => {
    const repo = await makeTmp();
    try {
      await writeFile(join(repo, 'file.js'), 'const x = 1;\nconst y = 2;\n');
      const results = await executeActions(
        [{ type: 'edit-file', path: 'file.js', search: 'const x = 1;', body: 'const x = 99;' }],
        repo,
      );
      assert.equal(results[0].ok, true);
      const content = await readFile(join(repo, 'file.js'), 'utf8');
      assert.ok(content.includes('const x = 99;'));
      assert.ok(content.includes('const y = 2;'));
    } finally {
      await cleanTmp();
    }
  });

  it('rejects path traversal', async () => {
    const repo = await makeTmp();
    try {
      const results = await executeActions(
        [{ type: 'write-file', path: '../escape.txt', body: 'evil' }],
        repo,
      );
      assert.equal(results[0].ok, false);
      assert.ok(results[0].error!.includes('traversal'));
    } finally {
      await cleanTmp();
    }
  });

  it('rejects absolute paths', async () => {
    const repo = await makeTmp();
    try {
      const results = await executeActions(
        [{ type: 'write-file', path: '/etc/passwd', body: 'evil' }],
        repo,
      );
      assert.equal(results[0].ok, false);
      assert.ok(results[0].error!.includes('Absolute'));
    } finally {
      await cleanTmp();
    }
  });

  it('mkdir creates a directory', async () => {
    const repo = await makeTmp();
    try {
      const results = await executeActions(
        [{ type: 'mkdir', path: 'new-dir/sub' }],
        repo,
      );
      assert.equal(results[0].ok, true);
    } finally {
      await cleanTmp();
    }
  });

  it('shell runs a command', async () => {
    const repo = await makeTmp();
    try {
      const results = await executeActions(
        [{ type: 'shell', cmd: 'echo hello' }],
        repo,
      );
      assert.equal(results[0].ok, true);
      assert.ok(results[0].output!.includes('hello'));
    } finally {
      await cleanTmp();
    }
  });

  it('reports unknown action type', async () => {
    const repo = await makeTmp();
    try {
      const results = await executeActions(
        [{ type: 'delete-file', path: 'foo.txt' }],
        repo,
      );
      assert.equal(results[0].ok, false);
      assert.ok(results[0].error!.includes('Unknown'));
    } finally {
      await cleanTmp();
    }
  });
});
