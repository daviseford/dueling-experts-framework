# ACB — Agent Collaboration Bridge

A local CLI tool that orchestrates structured, turn-based conversations between [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/codex/) CLIs. Agents alternate turns, output is validated, and a browser UI lets you watch and interject.

## Installation

Clone the repo and install dependencies:

```sh
git clone https://github.com/daviseford/claude-codex-chat.git ~/tools/agent-collab
cd ~/tools/agent-collab
npm install
```

Add the `acb` command to your PATH:

```sh
# bash/zsh
echo 'export PATH="$HOME/tools/agent-collab/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# or symlink
ln -s ~/tools/agent-collab/bin/acb /usr/local/bin/acb
```

On Windows (PowerShell):

```powershell
# Add to your PowerShell profile
Add-Content $PROFILE "`n`$env:PATH = `"$HOME\tools\agent-collab\bin;`$env:PATH`""
```

## Prerequisites

- **Node.js 20+** (required for `crypto.randomUUID()`)
- **Claude Code CLI** (`claude`) — installed and authenticated
- **Codex CLI** (`codex`) — installed and authenticated (requires ChatGPT Pro)
- Both CLIs available on PATH

## Usage

Run `acb` from any git repo:

```sh
cd ~/Projects/my-app
acb --topic "Plan a REST API for user management"
```

This creates a `.acb/` session directory in the target repo, starts the agent loop, and opens a watcher UI in your browser.

### Options

```
--topic <string>       Conversation topic (required)
--mode <string>        Session mode (default: planning)
--max-turns <number>   Maximum turns, 1-100 (default: 20)
--first <agent>        Which agent goes first: claude or codex (default: claude)
--resume <session-id>  Resume an interrupted session
```

### Examples

```sh
# Start a planning session, Codex goes first
acb --topic "Design a caching layer for the API" --first codex

# Limit to 6 turns
acb --topic "Review error handling in src/api/" --max-turns 6

# Resume a crashed session
acb --resume 550e8400-e29b-41d4-a716-446655440000
```

## How It Works

1. The orchestrator alternately invokes `claude --print` and `codex exec` as subprocesses
2. Each agent receives all prior turns as context and responds with YAML frontmatter + markdown
3. Output is validated, and the orchestrator assigns canonical turn numbers and filenames
4. Turns are written as immutable markdown files in `.acb/sessions/<id>/turns/`
5. A local HTTP server (bound to `127.0.0.1`) serves a watcher UI with 3-second polling

### Watcher UI

When the session starts, a URL is printed to the terminal:

```
Watcher UI: http://localhost:49152
```

Open it in a browser to:

- Watch the conversation in real time
- Type a message to interject at the next turn boundary
- Respond to agent escalations (`status: needs_human`)
- End the session cleanly

### Session Directory

```
my-app/
└── .acb/
    └── sessions/
        └── <session-id>/
            ├── session.json       # Session config + runtime state
            ├── turns/
            │   ├── turn-0001-claude.md
            │   ├── turn-0002-codex.md
            │   └── ...
            ├── artifacts/
            │   └── decisions.md   # Best-effort decisions log
            └── runtime/           # Ephemeral (prompt/output scratch files)
```

### Crash Recovery

If the process is interrupted, restart `acb` in the same repo. It automatically detects and resumes interrupted sessions. If multiple interrupted sessions exist, use `--resume <session-id>` to pick one.

## Turn Schema

Each turn file has YAML frontmatter:

```yaml
---
id: turn-0001-claude
turn: 1
from: claude
timestamp: 2026-03-23T14:30:00.000Z
status: complete
decisions:
  - Use polling over fs.watch
---

The markdown response body goes here.
```

**Status values:** `complete`, `needs_human`, `done`, `error`

## License

MIT
