import matter from 'gray-matter';

// ── Public types ──────────────────────────────────────────────────────

export type TurnStatus = 'complete' | 'needs_human' | 'done' | 'decided' | 'error';
/** TurnFrom is now a string -- participant IDs are dynamic (registry + roster). */
export type TurnFrom = string;

export type ReviewVerdict = 'approve' | 'fix';

export interface TurnData {
  id: string;
  turn: number;
  from: string;
  timestamp: string;
  status: TurnStatus;
  verdict?: ReviewVerdict;
  decisions?: string[];
  [key: string]: unknown;  // gray-matter may add extra fields
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data: TurnData | null;
  content: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const VALID_STATUS = /^(complete|needs_human|done|decided|error)$/;
const VALID_VERDICT = /^(approve|fix)$/;

// Disable gray-matter's JavaScript/CoffeeScript engines to prevent RCE via agent output.
const SAFE_ENGINES: Record<string, { parse: (input: string) => object }> = {
  javascript: { parse: (_input: string) => { throw new Error('JavaScript engine disabled for security'); } },
  js: { parse: (_input: string) => { throw new Error('JavaScript engine disabled for security'); } },
  coffee: { parse: (_input: string) => { throw new Error('CoffeeScript engine disabled for security'); } },
  coffeescript: { parse: (_input: string) => { throw new Error('CoffeeScript engine disabled for security'); } },
};

/**
 * Extract the frontmatter block from agent output.
 * Agents often emit preamble text before the "---" delimiter, or use "---"
 * as a horizontal rule. We find the real frontmatter by looking for "---"
 * followed by lines that look like YAML key-value pairs (must contain
 * "from:" and "status:" within the block before the closing "---").
 * Returns the extracted substring (starting at "---") or null if not found.
 */
export function extractFrontmatterBlock(raw: string): string | null {
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // Must be exactly "---" (reject "---js", "--- js", etc.)
    if (lines[i] !== '---') continue;

    // Look ahead for the closing "---" and check for required YAML keys
    let hasFrom = false;
    let hasStatus = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === '---') {
        // Found closing delimiter — is this real frontmatter?
        if (hasFrom && hasStatus) {
          return lines.slice(i).join('\n');
        }
        break; // Not frontmatter, keep searching for next "---" opener
      }
      if (/^from:\s/.test(lines[j])) hasFrom = true;
      if (/^status:\s/.test(lines[j])) hasStatus = true;
    }
  }
  return null;
}

/**
 * Pre-process frontmatter to wrap decision list items in double quotes.
 * Agents often produce unquoted strings with colons, backticks, or other
 * YAML-special characters that break the parser.
 */
function quoteDecisionItems(frontmatterBlock: string): string {
  const lines = frontmatterBlock.split('\n');
  let inDecisions = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^decisions:\s*$/.test(lines[i])) {
      inDecisions = true;
      continue;
    }
    if (inDecisions) {
      // Still in the decisions list — items start with "  - "
      const match = lines[i].match(/^(\s+-\s+)(.*)/);
      if (match) {
        const [, prefix, value] = match;
        // Wrap in double quotes, escaping existing double quotes and backslashes
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines[i] = `${prefix}"${escaped}"`;
      } else if (/^\S/.test(lines[i]) || lines[i] === '---') {
        // Non-indented line or closing delimiter — end of decisions block
        inDecisions = false;
      }
    }
  }
  return lines.join('\n');
}

/**
 * Parse and validate a turn's YAML frontmatter.
 * Returns { valid, errors, data, content }.
 */
export function validate(raw: string, expectedFrom?: string): ValidationResult {
  const errors: string[] = [];

  // Find the frontmatter block (may be preceded by agent preamble)
  const frontmatterBlock = extractFrontmatterBlock(raw);
  if (!frontmatterBlock) {
    return {
      valid: false,
      errors: ['No YAML frontmatter block found (expected a line with exactly "---")'],
      data: null,
      content: raw,
    };
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(frontmatterBlock, { engines: SAFE_ENGINES });
  } catch {
    // YAML parse failed — likely unquoted special characters in decisions.
    // Pre-process to quote list items and retry.
    const fixed = quoteDecisionItems(frontmatterBlock);
    try {
      parsed = matter(fixed, { engines: SAFE_ENGINES });
    } catch (err2) {
      return {
        valid: false,
        errors: [`Failed to parse frontmatter: ${(err2 as Error).message}`],
        data: null,
        content: raw,
      };
    }
  }

  const data = parsed.data as Record<string, unknown>;
  const { content } = parsed;

  // Required fields
  for (const field of ['id', 'turn', 'from', 'timestamp', 'status']) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate status enum
  if (data.status && !VALID_STATUS.test(String(data.status))) {
    errors.push(`Invalid status: "${data.status}". Must be: complete, needs_human, done, decided, or error`);
  }

  // Validate from field -- accept any non-empty string (participant IDs are dynamic)
  if (data.from !== undefined && data.from !== null && String(data.from).trim() === '') {
    errors.push(`Invalid from: "${data.from}". Must be a non-empty string`);
  }

  // Warn if agent claims to be someone else (orchestrator overrides, but log it)
  if (expectedFrom && data.from && data.from !== expectedFrom) {
    console.warn(`[validation] Agent claimed from="${data.from}" but expected "${expectedFrom}" (will override)`);
  }

  // Validate verdict field if present
  if (data.verdict !== undefined && data.verdict !== null) {
    if (!VALID_VERDICT.test(String(data.verdict))) {
      errors.push(`Invalid verdict: "${data.verdict}". Must be: approve or fix`);
    }
  }

  // Validate decisions is an array if present.
  // YAML often parses unquoted "key: value" strings as objects, so coerce
  // objects to "key: value" strings rather than rejecting them.
  if (data.decisions !== undefined) {
    if (!Array.isArray(data.decisions)) {
      errors.push(`"decisions" must be an array, got: ${typeof data.decisions}`);
    } else {
      data.decisions = (data.decisions as unknown[]).map((d: unknown) => {
        if (typeof d === 'string') return d;
        if (d && typeof d === 'object') {
          // YAML parsed "some text: more text" as { "some text": "more text" }
          return Object.entries(d as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(', ');
        }
        return String(d);
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: data as unknown as TurnData,
    content: content.trim(),
  };
}
