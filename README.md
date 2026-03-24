# Dueling Experts Framework

A local CLI tool that orchestrates structured, turn-based conversations between [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/codex/) CLIs. Agents debate a topic, implement changes in an isolated git worktree, review each other's work, and open a draft PR — all while you watch in a browser UI.

## Usage

Run `def` from anywhere:

```sh
cd ~/Projects/my-app
def "plan a REST API for user management"
```

This creates a `.def/` session directory in the target repo, starts the agent loop, and opens a watcher UI in your browser.

## Installation

Clone the repo and install dependencies:

```sh
git clone https://github.com/daviseford/claude-codex-chat.git ~/tools/def
cd ~/tools/def
npm install
```

Add the `def` command to your PATH:

```sh
# bash/zsh
echo 'export PATH="$HOME/tools/def/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# or symlink
ln -s ~/tools/def/bin/def /usr/local/bin/def
```

On Windows (PowerShell):

```powershell
# Add to your PowerShell profile
Add-Content $PROFILE "`n`$env:PATH = `"$HOME\tools\def\bin;`$env:PATH`""
```

## Prerequisites

- **Node.js 20+**
- **Claude Code CLI** (`claude`) — installed and authenticated
- **Codex CLI** (`codex`) — installed and authenticated (requires ChatGPT Pro)
- **GitHub CLI** (`gh`) — installed and authenticated (for automatic draft PR creation)
- Both agent CLIs available on PATH

### Options

```
--topic <string>              Conversation topic (required, or pass as positional args)
--mode <string>               edit (default) or planning (debate-only, no implementation)
--max-turns <number>          Maximum turns, 1-100 (default: 20)
--first <agent>               Which agent goes first: claude or codex (default: claude)
--impl-model <agent>          Which agent implements: claude or codex (default: claude)
--review-turns <number>       Max review/fix cycles, 1-50 (default: 6)
--no-pr                       Skip automatic draft PR creation
```

### Examples

```sh
# Quick start — positional args become the topic
def add dark mode to the dashboard

# Planning-only session, Codex goes first
def --topic "Design a caching layer for the API" --mode planning --first codex

# Limit to 6 turns, use Codex for implementation
def --topic "Refactor auth module" --max-turns 6 --impl-model codex

# Skip automatic PR creation
def --topic "Fix error handling in src/api/" --no-pr
```

## How It Works

Sessions progress through three phases:

### 1. Debate

Agents alternate turns debating the topic. When both agents signal `status: decided`, consensus is reached and the session advances. In `planning` mode, the session ends here.

### 2. Implement

In `edit` mode, a git worktree is created on a new branch (`def/<id>-<topic-slug>`). The implementing agent (set by `--impl-model`) gets full tool access and makes changes directly. The orchestrator captures a git diff after each implementation turn.

### 3. Review

The non-implementing agent reviews the changes. It can approve (`status: done`) or request fixes, cycling back to implement. This repeats until approval or the `--review-turns` limit is reached.

### Automatic PR Creation

When the session completes with changes on the branch, DEF automatically pushes the branch and creates a **draft PR** on GitHub via the `gh` CLI. The PR body includes the topic, decisions log, commit history, and diffstat. Use `--no-pr` to skip this.

### Watcher UI

When the session starts, a URL is printed to the terminal:

```
Watcher UI: http://localhost:49152
```

Open it in a browser to:

- Watch the conversation in real time
- Type a message to interject at the next turn boundary
- Respond to agent escalations (`status: needs_human`)
- End the session cleanly via the End Session button

### Session Directory

```
my-app/
└── .def/
    └── sessions/
        └── <session-id>/
            ├── session.json       # Session config + runtime state
            ├── turns/
            │   ├── turn-0001-claude.md
            │   ├── turn-0002-codex.md
            │   └── ...
            ├── artifacts/
            │   ├── decisions.md   # Compiled decisions log
            │   ├── diff-NNNN.patch
            │   └── pr-body.md     # Generated PR description
            ├── runtime/           # Ephemeral (prompt/output scratch files)
            └── logs/              # Per-invocation debug logs
```

## Turn Schema

Each turn file has YAML frontmatter:

```yaml
---
id: turn-0001-claude
turn: 1
from: claude
timestamp: 2026-03-23T14:30:00.000Z
status: complete
phase: debate
decisions:
  - Use polling over fs.watch
---
The markdown response body goes here.
```

**Status values:** `complete`, `needs_human`, `done`, `decided`, `error` (orchestrator-only)

## License

MIT
