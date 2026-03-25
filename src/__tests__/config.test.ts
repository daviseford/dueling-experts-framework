import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, mergeWithArgs } from '../config.js';
import type { ParsedArgs } from '../cli.js';

let testDir: string;
let projectDir: string;
let globalDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'def-config-test-'));
  projectDir = join(testDir, 'project');
  globalDir = join(testDir, 'global');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(globalDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns empty object when no config files exist', () => {
    const config = loadConfig(projectDir, globalDir);
    assert.deepEqual(config, {});
  });

  it('reads project .defrc with valid JSON', () => {
    writeFileSync(join(projectDir, '.defrc'), JSON.stringify({ mode: 'planning', noPr: true }));
    const config = loadConfig(projectDir, globalDir);
    assert.equal(config.mode, 'planning');
    assert.equal(config.noPr, true);
  });

  it('reads project def.config.json with valid JSON', () => {
    writeFileSync(join(projectDir, 'def.config.json'), JSON.stringify({ maxTurns: 30 }));
    const config = loadConfig(projectDir, globalDir);
    assert.equal(config.maxTurns, 30);
  });

  it('.defrc takes precedence over def.config.json when both exist', () => {
    writeFileSync(join(projectDir, '.defrc'), JSON.stringify({ mode: 'planning' }));
    writeFileSync(join(projectDir, 'def.config.json'), JSON.stringify({ mode: 'edit' }));
    const config = loadConfig(projectDir, globalDir);
    assert.equal(config.mode, 'planning');
  });

  it('global config provides defaults when no project config exists', () => {
    writeFileSync(join(globalDir, 'config.json'), JSON.stringify({ noFast: true }));
    const config = loadConfig(projectDir, globalDir);
    assert.equal(config.noFast, true);
  });

  it('project config overrides global config for overlapping keys', () => {
    writeFileSync(join(globalDir, 'config.json'), JSON.stringify({ mode: 'edit', noFast: true }));
    writeFileSync(join(projectDir, '.defrc'), JSON.stringify({ mode: 'planning' }));
    const config = loadConfig(projectDir, globalDir);
    assert.equal(config.mode, 'planning');
    // Global keys not overridden by project config are still inherited
    assert.equal(config.noFast, true);
  });

  it('warns on malformed JSON and returns empty', () => {
    writeFileSync(join(projectDir, '.defrc'), '{ invalid json }');
    const config = loadConfig(projectDir, globalDir);
    assert.deepEqual(config, {});
  });

  it('ignores unknown keys', () => {
    writeFileSync(join(projectDir, '.defrc'), JSON.stringify({ mode: 'edit', unknownKey: 'value', topic: 'ignored' }));
    const config = loadConfig(projectDir, globalDir);
    assert.equal(config.mode, 'edit');
    assert.equal((config as Record<string, unknown>)['unknownKey'], undefined);
    assert.equal((config as Record<string, unknown>)['topic'], undefined);
  });

  it('normalizes kebab-case keys to camelCase', () => {
    writeFileSync(join(projectDir, '.defrc'), JSON.stringify({
      'max-turns': 30,
      'impl-model': 'codex',
      'no-pr': true,
      'no-fast': true,
      'review-turns': 8,
    }));
    const config = loadConfig(projectDir, globalDir);
    assert.equal(config.maxTurns, 30);
    assert.equal(config.implModel, 'codex');
    assert.equal(config.noPr, true);
    assert.equal(config.noFast, true);
    assert.equal(config.reviewTurns, 8);
  });
});

describe('mergeWithArgs', () => {
  it('CLI values override config', () => {
    const config = { mode: 'planning', maxTurns: 30 };
    const args: ParsedArgs = { mode: 'edit' };
    const merged = mergeWithArgs(config, args);
    assert.equal(merged.mode, 'edit');
    assert.equal(merged.maxTurns, 30);
  });

  it('config fills undefined slots', () => {
    const config = { noPr: true, noFast: true, maxTurns: 15 };
    const args: ParsedArgs = { topic: 'test' };
    const merged = mergeWithArgs(config, args);
    assert.equal(merged.topic, 'test');
    assert.equal(merged.noPr, true);
    assert.equal(merged.noFast, true);
    assert.equal(merged.maxTurns, 15);
  });

  it('explicit false from CLI is not overridden by config true', () => {
    const config = { noPr: true };
    const args: ParsedArgs = { noPr: false };
    const merged = mergeWithArgs(config, args);
    assert.equal(merged.noPr, false);
  });
});
