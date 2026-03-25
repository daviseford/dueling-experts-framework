# Codex CLI Headless Reference

Quick reference for using OpenAI's Codex CLI in non-interactive (headless) mode. Focused on patterns relevant to DEF's agent orchestration.

## `codex exec` Flags

| Flag | Short | Description |
|------|-------|-------------|
| `PROMPT` | | Initial instruction (use `-` to read from stdin) |
| `--full-auto` | | Alias for `--sandbox workspace-write --ask-for-approval on-request` |
| `--skip-git-repo-check` | | Allow execution outside a Git repository |
| `--output-last-message` | `-o` | Write final assistant message to a file (still prints to stdout) |
| `--json` | | Emit newline-delimited JSON events instead of formatted text |
| `--model` | `-m` | Override configured model (e.g. `o4-mini`, `gpt-5-codex`) |
| `--sandbox` | `-s` | Sandbox policy: `read-only`, `workspace-write`, `danger-full-access` |
| `--ephemeral` | | Run without persisting session files to disk |
| `--image` | `-i` | Attach images (repeatable or comma-separated) |
| `--color` | | ANSI coloring: `always`, `never`, `auto` |
| `--config` | `-c` | Inline config overrides (repeatable) |
| `--profile` | `-p` | Select configuration profile |
| `--cd` | `-C` | Set workspace root before executing |
| `--dangerously-bypass-approvals-and-sandbox` | `--yolo` | Bypass all approvals and sandboxing |

## Passing Prompts

Three methods, in order of preference for headless use:

```bash
# 1. Direct argument
codex exec "write a sorting function"

# 2. Stdin with -
codex exec - < prompt.txt
echo "task" | codex exec -

# 3. Combined input via stdin
(echo "Review this diff:"; git diff) | codex exec -
```

**Important:** If a prompt argument is provided AND stdin is piped, stdin is ignored. Use `-` explicitly to read from stdin.

## Output Capture

| Stream | Content |
|--------|---------|
| **stdout** | Final assistant message only (clean for piping) |
| **stderr** | Progress and activity during execution |
| **`-o` file** | Copy of final message written to disk |
| **`--json`** | JSONL event stream on stdout instead of final message |

Combine `--json` with `-o` to get both structured events (stdout) and a natural-language summary (file).

## Sandbox & Permissions

### Sandbox Modes

| Mode | Files | Commands | Use Case |
|------|-------|----------|----------|
| `read-only` | Read only | None | Consultative analysis |
| `workspace-write` | Read + write in workspace | Workspace-scoped | Default for `--full-auto` |
| `danger-full-access` | Unrestricted | Unrestricted | Trusted environments only |

### What `--full-auto` Grants

`--full-auto` = `--sandbox workspace-write --ask-for-approval on-request`

- Read any files in the workspace
- Edit files within the workspace
- Run shell commands scoped to the workspace
- Approval required only for out-of-workspace or network operations

### Protected Paths

`.git`, `.agents`, `.codex` directories are always read-only, even in writable modes.

### Rules System

Fine-grained command control via rules files (no `--allowedTools` equivalent):

```
# ~/.codex/rules/default.rules  or  .codex/rules/*.rules
allow: npm test
allow: npm run build
deny: rm -rf /
```

Rules are more granular than sandbox modes — use them to allow specific commands without broadening sandbox access.

## Authentication (Headless/CI)

| Variable | Purpose |
|----------|---------|
| `CODEX_API_KEY` | API key for headless/CI environments |
| `OPENAI_API_KEY` | Alternative API key source |
| `CODEX_HOME` | Override default config location (`~/.codex`) |
| `CODEX_CA_CERTIFICATE` | PEM certificate file for TLS |
| `SSL_CERT_FILE` | Fallback certificate source |

Shell environment policy configurable in `config.toml`:
- `inherit = "none"` — clean environment for subprocesses
- `inherit = "core"` — trimmed set of environment variables

## Process Management

### Signal Handling

- Signal-based exits are normalized to exit code `128 + signal_number`
- Non-zero exit code = submission failure (use in CI scripts)

### Known Timeout Issue

Codex wraps commands in `bash -lc`. When a timeout kills the wrapper, child processes become orphaned and hold stdout/stderr pipes open indefinitely.

**Mitigation:** Use `setsid()` to create a process group, then `kill(-pid, signal)` to terminate the entire group. On Windows, `taskkill /T /F /pid <pid>` achieves the same effect.

### Session Resumption

```bash
codex resume [SESSION_ID]
```

Non-interactive sessions can be resumed if `--ephemeral` was not used. Sessions persist to `~/.codex/sessions/`.

## Rate Limits & Context Window

| Constraint | Value |
|-----------|-------|
| CLI context window | ~258k tokens |
| Underlying model capacity | ~400k tokens |
| Usage window | 5-hour rolling (not daily reset) |
| Quota scope | Shared between local messages and cloud tasks |

Both prompt and completion tokens consume from the same quota. Tokens used 5 hours ago become available again.

## CI/CD Best Practices

1. **Use the GitHub Action** for CI jobs: `openai/codex-action@v1`
2. **Start restrictive:** `--full-auto` (workspace-write). Only escalate to `danger-full-access` after verifying stability.
3. **Capture structured output:** `--json` for machine-readable events, `-o` for summary file.
4. **Check exit codes:** Non-zero = failure. Wire into CI pipelines.
5. **Store keys as secrets:** Use `CODEX_API_KEY` as a GitHub secret, never in code.
6. **Use `--ephemeral`** in CI to avoid session file accumulation.

## DEF-Specific Notes

### Current Invocation

**Implement phase (full tool access):**
```
codex exec --full-auto --ephemeral --skip-git-repo-check -o <runtime/output.md> [--model o4-mini]
```

**Plan/review phases (read-only):**
```
codex exec --sandbox read-only --ephemeral --skip-git-repo-check -o <runtime/output.md> [--model o4-mini]
```

Prompt is piped to stdin via `createReadStream().pipe(child.stdin)`. Output is read from the `-o` file after the process closes.

### Codex vs Claude in DEF

| Aspect | Claude | Codex |
|--------|--------|-------|
| Output capture | stdout | File (`-o`) |
| Phase-specific args | `implementArgs`, `reviewArgs` | `args` (implement), `reviewArgs` (plan/review) |
| Implement tool access | `--allowedTools *` | `--full-auto` (workspace-write) |
| Plan/review tool access | `Read`, `Glob`, `Grep`, scoped `Bash` | `--sandbox read-only` |
| Fast model | `haiku` | `o4-mini` |
| Session persistence | N/A | `--ephemeral` (no session files) |

### Remaining Opportunities

- **No `--json` usage.** We could capture structured JSONL events for richer progress tracking in the watcher UI.

## External References

- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference)
- [Non-interactive Mode](https://developers.openai.com/codex/noninteractive)
- [Agent Approvals & Security](https://developers.openai.com/codex/agent-approvals-security)
- [Configuration Reference](https://developers.openai.com/codex/config-reference)
- [GitHub Action](https://developers.openai.com/codex/github-action)
- [Sandboxing Concepts](https://developers.openai.com/codex/concepts/sandboxing)
- [GitHub Repository](https://github.com/openai/codex)
