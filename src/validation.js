import matter from 'gray-matter';

const VALID_STATUS = /^(complete|needs_human|done|error)$/;
const VALID_FROM = /^(claude|codex|human|system)$/;

// Disable gray-matter's JavaScript/CoffeeScript engines to prevent RCE via agent output.
// An adversarial agent could return "---js\n require('child_process').exec(...) \n---"
// which gray-matter would eval(). Block all non-YAML engines explicitly.
const SAFE_ENGINES = {
  javascript: { parse: () => { throw new Error('JavaScript engine disabled for security'); } },
  js: { parse: () => { throw new Error('JavaScript engine disabled for security'); } },
  coffee: { parse: () => { throw new Error('CoffeeScript engine disabled for security'); } },
  coffeescript: { parse: () => { throw new Error('CoffeeScript engine disabled for security'); } },
};

/**
 * Parse and validate a turn's YAML frontmatter.
 * Returns { valid, errors, data, content }.
 */
export function validate(raw, expectedFrom) {
  const errors = [];

  // Reject frontmatter with language specifiers (e.g., "---js", "--- js")
  // The opening delimiter must be exactly "---" with nothing else on the line.
  const firstLine = raw.split(/\r?\n/)[0];
  if (firstLine !== '---') {
    return {
      valid: false,
      errors: ['Frontmatter opening delimiter must be exactly "---" (security)'],
      data: null,
      content: raw,
    };
  }

  let parsed;
  try {
    parsed = matter(raw, { engines: SAFE_ENGINES });
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
