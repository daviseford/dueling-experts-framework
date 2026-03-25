import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Extract file paths from decision strings.
 * Looks for substrings that look like file paths (contain / or \ and end with a file extension).
 */
export function extractFilePaths(decisions: string[]): string[] {
  const pathPattern = /(?:^|\s|`)((?:[\w.-]+[/\\])+[\w.-]+\.\w+)/g;
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
 * Verify that file paths exist relative to repoRoot.
 * Returns the list of missing paths.
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
