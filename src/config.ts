import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ParsedArgs } from './cli.js';

export interface DefConfig {
  mode?: string;
  maxTurns?: number;
  first?: string;
  implModel?: string;
  reviewTurns?: number;
  noPr?: boolean;
  noFast?: boolean;
}

const KEBAB_TO_CAMEL: Record<string, keyof DefConfig> = {
  'max-turns': 'maxTurns',
  'impl-model': 'implModel',
  'review-turns': 'reviewTurns',
  'no-pr': 'noPr',
  'no-fast': 'noFast',
};

const RECOGNIZED_KEYS = new Set<string>([
  'mode', 'maxTurns', 'first', 'implModel', 'reviewTurns', 'noPr', 'noFast',
]);

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    process.stderr.write(`Warning: failed to parse config ${filePath}: ${(err as Error).message}\n`);
    return null;
  }
}

function normalizeKeys(obj: Record<string, unknown>): DefConfig {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = KEBAB_TO_CAMEL[key] ?? key;
    if (RECOGNIZED_KEYS.has(camelKey)) {
      result[camelKey] = value;
    }
  }
  return result as DefConfig;
}

export function loadConfig(projectRoot: string, globalConfigDir?: string): DefConfig {
  // Project-level: .defrc then def.config.json (first found wins)
  let projectConfig: DefConfig = {};
  const projectPaths = [
    join(projectRoot, '.defrc'),
    join(projectRoot, 'def.config.json'),
  ];
  for (const p of projectPaths) {
    const data = readJsonFile(p);
    if (data !== null) {
      projectConfig = normalizeKeys(data);
      break;
    }
  }

  // Global config
  let globalConfig: DefConfig = {};
  const globalDir = globalConfigDir ?? join(homedir(), '.config', 'def');
  const globalData = readJsonFile(join(globalDir, 'config.json'));
  if (globalData !== null) {
    globalConfig = normalizeKeys(globalData);
  }

  // Merge: project overrides global
  return { ...globalConfig, ...projectConfig };
}

export function mergeWithArgs(config: DefConfig, args: ParsedArgs): ParsedArgs {
  const merged: ParsedArgs = { ...args };
  for (const key of Object.keys(config) as (keyof DefConfig)[]) {
    if ((args as Record<string, unknown>)[key] === undefined) {
      (merged as Record<string, unknown>)[key] = config[key];
    }
  }
  return merged;
}
