# Changelog

## [0.1.1](https://github.com/daviseford/claude-codex-chat/compare/debate-engine-framework-v0.1.0...debate-engine-framework-v0.1.1) (2026-03-24)


### Features

* add debate-then-implement session lifecycle ([1170022](https://github.com/daviseford/claude-codex-chat/commit/117002245d64356f7176f26c15f1be7b9e154ce0))
* add git worktree isolation for concurrent sessions ([0ef60d5](https://github.com/daviseford/claude-codex-chat/commit/0ef60d58c43df9424676343c958373cffab29263))
* auto-open browser when watcher UI starts ([ba74138](https://github.com/daviseford/claude-codex-chat/commit/ba7413865bb1324e11bc32817f825d40070e1e48))
* git worktree isolation for concurrent sessions ([5e0bbad](https://github.com/daviseford/claude-codex-chat/commit/5e0bbad6d3ef99803be6ccb71c35aa2004998006))
* implement Phase 1 core loop — headless agent collaboration ([2469ef1](https://github.com/daviseford/claude-codex-chat/commit/2469ef1b71970a3551ac3cc0c9c30f3777c87c3a))
* implement Phase 2 watcher UI + human-in-the-loop ([5a1e7de](https://github.com/daviseford/claude-codex-chat/commit/5a1e7de2219c13b6e74b0593b6e5dae482ee75ee))
* implement Phase 3 crash recovery ([2656b91](https://github.com/daviseford/claude-codex-chat/commit/2656b91b1c65c478ad6dfcc88895b1fe3372dc41))
* replace def-action blocks with native agent execution ([9d5a610](https://github.com/daviseford/claude-codex-chat/commit/9d5a61077f1cb5a740ed3ac700ffaec032dbe3ee))
* replace def-action blocks with native agent execution ([efd2749](https://github.com/daviseford/claude-codex-chat/commit/efd27493fecb5ddda6e9972e777fc899a47b4b78))
* show thinking indicator in UI while agent is generating ([6121a0d](https://github.com/daviseford/claude-codex-chat/commit/6121a0d6dfd5cd406df96e15574f277d1847408c))
* support multiple concurrent sessions ([1c67892](https://github.com/daviseford/claude-codex-chat/commit/1c67892db16531b00ffcbd4d340e686d798cd981))
* **ui:** add all watcher UI components with shadcn/ui ([7bb3d5d](https://github.com/daviseford/claude-codex-chat/commit/7bb3d5d75fa5f63f97bd3e9328e5deba926b87f5))
* **ui:** add collapse button at bottom of each turn card ([9536bf7](https://github.com/daviseford/claude-codex-chat/commit/9536bf763c5240fac7a6bce42b391437e0baf358))
* **ui:** add collapsible turns, shadcn spinner, enhanced status bar ([c85c622](https://github.com/daviseford/claude-codex-chat/commit/c85c62216312f6ace0daa0721f1cad2925fc086b))
* **ui:** make status bar stats more prominent ([e341e2e](https://github.com/daviseford/claude-codex-chat/commit/e341e2e7c785b2c8b1bc7be4b65a4ef5c4a8c799))
* **ui:** redesign with refined terminal dashboard aesthetic ([9c4f59b](https://github.com/daviseford/claude-codex-chat/commit/9c4f59b640aba3781df5b2e3964835dfe195cb0d))
* **ui:** render turn content as markdown, fix scroll containment ([d29ad35](https://github.com/daviseford/claude-codex-chat/commit/d29ad3544302034013ee8191ae629f5635a263a0))
* **ui:** scaffold Vite + React + TypeScript + shadcn/ui project ([6aff6e6](https://github.com/daviseford/claude-codex-chat/commit/6aff6e64a17f09ae2b7f8b6439610d0d54c3f934))
* **ui:** wire polling hook and integrate all components in App ([e8979b2](https://github.com/daviseford/claude-codex-chat/commit/e8979b29c5dd710d44a0dd81714ed0b9baf4504f))


### Bug Fixes

* add error logging, fix stdin piping, fix UI connecting state ([47358df](https://github.com/daviseford/claude-codex-chat/commit/47358df8b1ba21fd193d75003cde90dff757df5c))
* address code simplicity review findings (P1-P3) ([de5d886](https://github.com/daviseford/claude-codex-chat/commit/de5d8866e2aa010289cfc5d9645073beec5cf80a))
* address P1/P2 review findings ([3bf5f62](https://github.com/daviseford/claude-codex-chat/commit/3bf5f62a44aa7ba0ea795251afd4047a012c651a))
* address review findings for native agent execution ([4569445](https://github.com/daviseford/claude-codex-chat/commit/456944538ce6ae5bc6b61b2bb1ee93aaa3b07f7d))
* address review findings for worktree isolation ([1c91077](https://github.com/daviseford/claude-codex-chat/commit/1c910772f96ce22daea305789c10f803f53f0def))
* address review round 2 findings ([e54dbe2](https://github.com/daviseford/claude-codex-chat/commit/e54dbe2fed91129fe349bf11efc3971aa2e7c885))
* address round 2 review findings ([028a1a8](https://github.com/daviseford/claude-codex-chat/commit/028a1a8f242105946762e86cdb37508282e60363))
* address security review round 2 findings ([65aa47c](https://github.com/daviseford/claude-codex-chat/commit/65aa47c35df121a21ef5ec9fc3d6c74b26d50279))
* address security, architecture, and frontend review findings ([814a377](https://github.com/daviseford/claude-codex-chat/commit/814a3773ffd152a7341da7d5f311222cad59f599))
* always auto-scroll to bottom when new turns arrive ([cd9abb2](https://github.com/daviseford/claude-codex-chat/commit/cd9abb2a86aa8fb9ebc851f1dec50be3ba0daec6))
* coerce YAML-parsed decision objects to strings ([5dcf084](https://github.com/daviseford/claude-codex-chat/commit/5dcf084333b82bf69036378d8e8afe8c327af0c2))
* convert Windows paths to file:// URLs in bin/acb entry point ([282cf7f](https://github.com/daviseford/claude-codex-chat/commit/282cf7f2a570c604acc6febfd0e8191d78591f8d))
* ensure turns/ directory exists before writing (defensive mkdir) ([edebc86](https://github.com/daviseford/claude-codex-chat/commit/edebc86d64c088a681ce872e84662b3c6bb65b1d))
* exit process on fatal orchestrator error instead of hanging ([14eaecf](https://github.com/daviseford/claude-codex-chat/commit/14eaecfa1a29aedb9240ac1308621b02d34f14e1))
* extract frontmatter from anywhere in agent output, not just line 1 ([25171c8](https://github.com/daviseford/claude-codex-chat/commit/25171c8b94b4b31f6257f8cea7f9584a5d22a2e6))
* harden worktree path validation and recovery safety ([58df473](https://github.com/daviseford/claude-codex-chat/commit/58df4734c79cb169fea2a41e1fcc5e055239df5d))
* move schedulePoll() into finally block so polling survives early returns ([4b30a18](https://github.com/daviseford/claude-codex-chat/commit/4b30a1873647d5485b896abad49d7c4a63d5f7fe))
* prevent agents from ending session on turn 1 ([44d0502](https://github.com/daviseford/claude-codex-chat/commit/44d0502e78fbd7f5bf4775d7e176d2397d9c6f57))
* print artifact paths and session directory on completion ([626a033](https://github.com/daviseford/claude-codex-chat/commit/626a0334bc9c04135750e293407f3d1183d0efec))
* recover from YAML-breaking characters in decision list items ([be04821](https://github.com/daviseford/claude-codex-chat/commit/be04821d44e99f3e12305828c87b9e073335d52b))
* recovery correctness and state integrity (Phase 1) ([ee14d8b](https://github.com/daviseford/claude-codex-chat/commit/ee14d8bc4bca5095bdcd7a1f5cc6b4d16be42390))
* remove invalid --no-project-doc flag from Codex invocation ([5c4dbb9](https://github.com/daviseford/claude-codex-chat/commit/5c4dbb9c5427bec5981376c75f298b9968e05eb5))
* resolve 12 inconsistencies found by Codex review (3 P1, 9 P2) ([679eaa7](https://github.com/daviseford/claude-codex-chat/commit/679eaa730aa6ffbc1cd0d518d3f48cc27d3998fa))
* restore writeFile import needed by savePromptForTurn ([9ecd38f](https://github.com/daviseford/claude-codex-chat/commit/9ecd38f0a5d7341fbe0749b4bbc33f5da94e2abb))
* revert to createReadStream pipe for stdin, increase timeout to 180s ([0daa17c](https://github.com/daviseford/claude-codex-chat/commit/0daa17c7ea3b6891258db4b4688e2576a4d4cb0b))
* review round 2 - bug fixes and cleanup ([cbc4a31](https://github.com/daviseford/claude-codex-chat/commit/cbc4a31f1bac697053ee64f2a12273599a6e6432))
* show waiting message in UI while first agent turn is generating ([cf11d45](https://github.com/daviseford/claude-codex-chat/commit/cf11d454159f8ffd64588949377740e7d0f2141c))
* smarter frontmatter extraction — require from: and status: keys ([e860ac3](https://github.com/daviseford/claude-codex-chat/commit/e860ac3eca8199e7099bc36ad53ad88b453449ec))
* **ui:** detect server shutdown and show session ended state ([677fe59](https://github.com/daviseford/claude-codex-chat/commit/677fe59234815af67919001646b62900abc8bfb5))
* **ui:** only auto-scroll on new turns or thinking state changes ([85b2d5a](https://github.com/daviseford/claude-codex-chat/commit/85b2d5aa0597d696040a919408be6ec9e7bf62c0))
* update AGENTS.md for three-phase lifecycle, misc P2 fixes ([f0159ca](https://github.com/daviseford/claude-codex-chat/commit/f0159ca58b82d830e709fecc5d154a7bafd8859f))
* use shell on Windows for npm-installed CLI shims (.cmd) ([d0c31ad](https://github.com/daviseford/claude-codex-chat/commit/d0c31ad437055ae80d285598710364e634bb5288))
* use tsx/esm import in bin/def for Windows compatibility ([cf69266](https://github.com/daviseford/claude-codex-chat/commit/cf6926676941910055edb6ac41e392f092ddd0d6))


### Reverts

* **ui:** remove markdown rendering, show raw text ([eecfafa](https://github.com/daviseford/claude-codex-chat/commit/eecfafa269941397d1e2ed184cde6cd77be3b584))
