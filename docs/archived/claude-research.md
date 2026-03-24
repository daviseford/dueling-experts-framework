# Claude Code: Piping stdin & Tool Access in Non-Interactive Mode

## The Critical Rule

**Piping stdin without `-p` crashes.** Claude Code uses Ink (a React-based TUI renderer) which requires raw mode on stdin. When stdin comes from a pipe instead of a TTY, it throws:

```
Error: Raw mode is not supported on the current process.stdin
```

So `claude < prompt.md` and `cat prompt.md | claude` will **not** work without `-p`.

---

## Correct Invocation Patterns

The `-p` flag (alias `--print`) is required to enter non-interactive mode. It is the entry point — not an optional add-on.

```bash
# Pass a markdown file as the prompt
claude -p "$(cat prompt.md)"

# Pipe a file as context, prompt inline
cat prompt.md | claude -p "follow the instructions in this content"

# Pipe context + inline prompt (common pattern)
cat src/utils.ts | claude -p "add TypeScript types to this file"
git diff HEAD~1 | claude -p "review this diff for security issues"
```

---

## Tool Access in `-p` Mode

Tools (Bash, Read, Edit, Write, etc.) are available in `-p` mode, but **require explicit `--allowedTools`**. Without it, Claude may ask for permission interactively — which hangs in a non-interactive context.

```bash
# Specific tools
claude -p "run tests and fix failures" --allowedTools "Bash,Read,Edit,Write"

# All tools
claude -p "complete the task" --allowedTools "*"

# Scoped bash commands only
claude -p "commit staged changes" --allowedTools 'Bash(git:*)'
```

---

## Full Non-Interactive Command Reference

```bash
claude -p "your prompt"                        # basic non-interactive
claude -p "prompt" --allowedTools "*"          # with full tool access
claude -p "prompt" --output-format json        # structured JSON output
claude -p "prompt" --output-format stream-json # streaming JSONL output
claude -p "prompt" --max-turns 3               # limit agent iterations
claude -p "prompt" --model claude-opus-4-6      # specify model
```

---

## Summary

| Invocation                       | Works? | Notes                          |
| -------------------------------- | ------ | ------------------------------ |
| `cat prompt.md \| claude`        | ❌     | Crashes — Ink raw mode error   |
| `claude < prompt.md`             | ❌     | Same crash                     |
| `claude -p "$(cat prompt.md)"`   | ✅     | Preferred for markdown prompts |
| `cat file \| claude -p "prompt"` | ✅     | Good for piping context        |
| Tool use in `-p` mode            | ✅     | Requires `--allowedTools` flag |

## From CLaude Code

Both work. Here are the results:  
 Test 1: Positional prompt, no --print (interactive mode)  
 claude "Create a file..." --dangerously-skip-permissions

- Tools: YES — it created hello.txt - Exited cleanly: YES — exit code 0, no hang
- Notable: prints Warning: no stdin data received in 3s, proceeding without it — add < /dev/null to suppress the 3s wait - Stdout: contains human-readable status text ("Done. Created hello.txt..."), not raw output

Test 2: --print with --allowedTools

echo "Create a file..." | claude --print --allowedTools "Bash Edit Read Write Glob Grep"

- Tools: YES — it created hello.txt
- Exited cleanly: YES
- Stdout: clean text output, same as normal --print

Implications for the design

Both approaches are viable, but they have different tradeoffs:

┌───────────────────────┬──────────────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│ │ Test 1 (no --print) │ Test 2 (--print + --allowedTools) │
├───────────────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ Tool access │ Full │ Scoped to allowlist │
├───────────────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ Stdin │ Positional arg (pipe stdin ignored after 3s) │ Piped prompt works normally │
├───────────────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ Stdout │ UI-flavored text (spinners etc.) │ Clean text │
├───────────────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ Permissions │ Needs --dangerously-skip-permissions │ Needs --dangerously-skip-permissions or permission flags │
├───────────────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ Fits current agent.ts │ Requires refactoring stdin/stdout pattern │ Minimal changes — just add --allowedTools for implement │
└───────────────────────┴──────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘

Test 2 is the winner for your architecture. It preserves the existing stdin-pipe + stdout-capture pattern in agent.ts. The only change needed is:

claude: {
cmd: 'claude',
args: ['--print'], // debate/review: no tools
captureStdout: true,
},
claudeImplement: {
cmd: 'claude',
args: ['--print', '--dangerously-skip-permissions',
'--allowedTools', 'Bash Edit Read Write Glob Grep'],
captureStdout: true, // still capture stdout for logging
},

The implement phase would then: run the agent with tools → capture git diff from worktree → pass diff to reviewer. The stdout capture becomes a debug log rather than the primary output.

Want me to update the requirements doc with these findings?

## From Codex

I tested it locally today, March 24, 2026. Result: claude without --print does accept piped stdin and exit normally. More importantly, with --permission-mode bypassPermissions, it retained tool access and
successfully created a probe file from the piped prompt. Without an explicit non-interactive permission mode, the same write test hung for 45s and produced no file.

So the critical-path answer is:

- Yes, piped stdin does not force Claude into print-only behavior.
- Yes, tool use works in that mode.
- But not with plain claude alone as currently specified in the requirements.
- For implement-phase automation, you should treat claude --permission-mode bypassPermissions (or another non-interactive permission strategy) as required, plus worktree isolation.

One more relevant detail: the existing Windows stdin piping approach in /D:/Projects/claude-codex-chat/src/agent.ts:90 already notes that stdin.write()+end() failed and createReadStream(...).pipe(child.stdin) was
needed. That part looks compatible with this plan.
