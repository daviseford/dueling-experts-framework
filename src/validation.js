import matter from 'gray-matter';

const VALID_STATUS = /^(complete|needs_human|done|error)$/;
const VALID_FROM = /^(claude|codex|human|system)$/;

// Disable gray-matter's JavaScript/CoffeeScript engines to prevent RCE via agent output.
const SAFE_ENGINES = {
  javascript: { parse: () => { throw new Error('JavaScript engine disabled for security'); } },
  js: { parse: () => { throw new Error('JavaScript engine disabled for security'); } },
  coffee: { parse: () => { throw new Error('CoffeeScript engine disabled for security'); } },
  coffeescript: { parse: () => { throw new Error('CoffeeScript engine disabled for security'); } },
};

/**
 * Extract the frontmatter block from agent output.
 * Agents often emit preamble text before the "---" delimiter, or use "---"
 * as a horizontal rule. We find the real frontmatter by looking for "---"
 * followed by lines that look like YAML key-value pairs (must contain
 * "from:" and "status:" within the block before the closing "---").
 * Returns the extracted substring (starting at "---") or null if not found.
 */
function extractFrontmatterBlock(raw) {
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
 * Parse and validate a turn's YAML frontmatter.
 * Returns { valid, errors, data, content }.
 */
export function validate(raw, expectedFrom) {
  const errors = [];

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

  let parsed;
  try {
    parsed = matter(frontmatterBlock, { engines: SAFE_ENGINES });
  } catch (err) {
    return {
      valid: false,
      errors: [`Failed to parse frontmatter: ${err.message}`],
      data: null,
      content: raw,
    };
  }

  const { data, content } = parsed;

  // Required fields
  for (const field of ['id', 'turn', 'from', 'timestamp', 'status']) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate status enum
  if (data.status && !VALID_STATUS.test(data.status)) {
    errors.push(`Invalid status: "${data.status}". Must be: complete, needs_human, done, or error`);
  }

  // Validate from field
  if (data.from && !VALID_FROM.test(data.from)) {
    errors.push(`Invalid from: "${data.from}". Must be: claude, codex, human, or system`);
  }

  // Warn if agent claims to be someone else (orchestrator overrides, but log it)
  if (expectedFrom && data.from && data.from !== expectedFrom) {
    console.warn(`[validation] Agent claimed from="${data.from}" but expected "${expectedFrom}" (will override)`);
  }

  // Validate decisions is an array of strings if present
  if (data.decisions !== undefined) {
    if (!Array.isArray(data.decisions)) {
      errors.push(`"decisions" must be an array, got: ${typeof data.decisions}`);
    } else if (!data.decisions.every((d) => typeof d === 'string')) {
      errors.push('"decisions" array must contain only strings');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data,
    content: content.trim(),
  };
}
