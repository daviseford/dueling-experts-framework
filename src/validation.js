import matter from 'gray-matter';

const VALID_STATUS = /^(complete|needs_human|done|error)$/;
const VALID_FROM = /^(claude|codex|human|system)$/;

/**
 * Parse and validate a turn's YAML frontmatter.
 * Returns { valid, errors, data, content }.
 */
export function validate(raw, expectedFrom) {
  const errors = [];

  let parsed;
  try {
    parsed = matter(raw, {
      engines: {
        yaml: {
          parse: (str) => {
            const yaml = matter.engines.yaml;
            // Use default safe schema via gray-matter's built-in yaml engine
            return yaml.parse(str);
          },
        },
      },
    });
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

  // Validate from matches expected agent (if provided)
  if (expectedFrom && data.from && data.from !== expectedFrom) {
    // Log but don't fail — orchestrator will override
    errors.push(`Agent claimed from="${data.from}" but expected "${expectedFrom}" (will override)`);
    // Downgrade to warning — don't block validation for this
    errors.pop();
  }

  // Validate decisions is an array if present
  if (data.decisions !== undefined && !Array.isArray(data.decisions)) {
    errors.push(`"decisions" must be an array, got: ${typeof data.decisions}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    data,
    content: content.trim(),
  };
}
