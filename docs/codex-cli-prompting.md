# How to Invoke the Codex CLI with a Prompt

## Passing a Prompt Inline

You can specify a prompt directly on the command line when launching Codex:

```bash
codex "refactor the auth module to use async/await"
```

This opens the TUI with your prompt pre-loaded and sent immediately.

---

## Non-Interactive / Exec Mode

For scripting, automation, or CI pipelines, use `exec` mode (alias: `e`):

```bash
codex exec "add JSDoc comments to all exported functions"
# or shorthand:
codex e "add JSDoc comments to all exported functions"
```

This runs Codex without a TTY and streams results to stdout.

---

## Passing a Markdown File as the Prompt

When your prompt lives in a markdown file, there are three good approaches:

### 1. Shell substitution
```bash
codex exec "$(cat my-prompt.md)"
```
Inlines the file contents as the prompt. Simple and effective for small-to-medium files.

> ⚠️ Can break if the markdown contains backticks or `$variables` that the shell tries to interpolate.

### 2. Input redirection (recommended)
```bash
codex exec < my-prompt.md
```
Cleanest option for static markdown files. Bypasses shell interpretation entirely, so special characters are safe.

### 3. Pipe via stdin
```bash
cat my-prompt.md | codex exec
```
Functionally equivalent to input redirection. Useful when chaining commands.

### 4. Heredoc (for dynamically built prompts)
```bash
codex exec <<'EOF'
## Task
Refactor the auth module...
EOF
```

---

## Which Approach to Use

| Situation | Recommended approach |
|---|---|
| Static `.md` file | `codex exec < my-prompt.md` |
| Small file, no special characters | `codex exec "$(cat my-prompt.md)"` |
| Scripting / CI pipeline | `codex exec < my-prompt.md` or pipe |
| Dynamically generated prompt | Heredoc (`<<'EOF'`) |

**Bottom line:** For a plain markdown file, `codex exec < my-prompt.md` is the safest and cleanest option.

---

## Resuming a Session with a Follow-Up Prompt

```bash
codex --last --input "now add unit tests for what you just wrote"
```

`--last` resumes the most recent session; `--input` sends a follow-up instruction immediately.

---

## Cloud Tasks

```bash
codex cloud exec --env ENV_ID "your prompt here"
```

Add `--attempts 1–4` for best-of-N runs.
