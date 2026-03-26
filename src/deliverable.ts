import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Extract file paths from decision strings for advisory reporting.
 * Used to generate a deliverables summary in the plan artifact -- NOT for
 * blocking consensus. Missing files are expected (plans reference files to
 * be created) and are reported as "files to be created."
 */
export function extractFilePaths(decisions: string[]): string[] {
  const pathPattern = /(?:^|\s|`|"|'|\()((?:[\w.-]+[/\\])+[\w.-]+\.\w+)/g;
  const paths = new Set<string>();

  for (const decision of decisions) {
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(decision)) !== null) {
      const candidate = match[1];
      // Skip URLs
      if (candidate.includes('://')) continue;
      paths.add(candidate);
    }
  }

  return [...paths];
}

/**
 * Check which file paths exist relative to repoRoot.
 * Returns the list of missing paths (advisory -- missing paths are expected
 * for files the plan intends to create).
 */
export async function verifyDeliverables(paths: string[], repoRoot: string): Promise<{ missing: string[] }> {
  const missing: string[] = [];

  for (const p of paths) {
    const resolved = resolve(repoRoot, p);
    try {
      await access(resolved);
    } catch {
      missing.push(p);
    }
  }

  return { missing };
}
