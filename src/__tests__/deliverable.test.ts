import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { extractFilePaths, verifyDeliverables } from '../deliverable.js';

describe('extractFilePaths', () => {
  it('extracts paths like docs/plans/foo.md and src/bar.ts', () => {
    const decisions = [
      'Create the plan at docs/plans/foo.md',
      'Modify src/bar.ts to add the new function',
    ];
    const paths = extractFilePaths(decisions);
    assert.ok(paths.includes('docs/plans/foo.md'));
    assert.ok(paths.includes('src/bar.ts'));
  });

  it('ignores non-path strings', () => {
    const decisions = [
      'We should use TypeScript for this',
      'The function should return a boolean',
    ];
    const paths = extractFilePaths(decisions);
    assert.equal(paths.length, 0);
  });

  it('ignores URLs', () => {
    const decisions = [
      'See https://example.com/docs/guide.html for reference',
    ];
    const paths = extractFilePaths(decisions);
    assert.equal(paths.length, 0);
  });

  it('handles decision strings with mixed content', () => {
    const decisions = [
      'Write the implementation in src/orchestrator.ts and update src/__tests__/tier.test.ts accordingly',
    ];
    const paths = extractFilePaths(decisions);
    assert.ok(paths.includes('src/orchestrator.ts'));
    assert.ok(paths.includes('src/__tests__/tier.test.ts'));
  });

  it('deduplicates paths', () => {
    const decisions = [
      'Modify src/foo.ts',
      'Also update src/foo.ts with the new export',
    ];
    const paths = extractFilePaths(decisions);
    const fooCount = paths.filter(p => p === 'src/foo.ts').length;
    assert.equal(fooCount, 1);
  });

  it('extracts paths wrapped in backticks', () => {
    const decisions = [
      'Create `src/deliverable.ts` with the extraction logic',
    ];
    const paths = extractFilePaths(decisions);
    assert.ok(paths.includes('src/deliverable.ts'));
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(extractFilePaths([]), []);
  });
});

describe('verifyDeliverables', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `def-deliverable-test-${randomUUID()}`);
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'exists.ts'), 'export {};\n');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty missing when all files exist', async () => {
    const { missing } = await verifyDeliverables(['src/exists.ts'], tmpDir);
    assert.deepEqual(missing, []);
  });

  it('returns correct missing list when files are absent', async () => {
    const { missing } = await verifyDeliverables(
      ['src/exists.ts', 'src/missing.ts', 'docs/gone.md'],
      tmpDir,
    );
    assert.deepEqual(missing, ['src/missing.ts', 'docs/gone.md']);
  });

  it('handles empty paths list', async () => {
    const { missing } = await verifyDeliverables([], tmpDir);
    assert.deepEqual(missing, []);
  });
});
