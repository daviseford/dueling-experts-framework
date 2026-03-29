# Changelog

## [0.0.14](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.13...def-v0.0.14) (2026-03-29)


### Features

* cross-repo session discovery in explorer + 15min plan timeout ([#101](https://github.com/daviseford/dueling-experts-framework/issues/101)) ([bb399dd](https://github.com/daviseford/dueling-experts-framework/commit/bb399dd1c4c57224d88ccba830f852b2ee0fea80))

## [0.0.13](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.12...def-v0.0.13) (2026-03-29)


### Bug Fixes

* remove cost estimate display from session startup ([#99](https://github.com/daviseford/dueling-experts-framework/issues/99)) ([798a868](https://github.com/daviseford/dueling-experts-framework/commit/798a868984c462816a8cbc385de0888844ac7a28))

## [0.0.12](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.11...def-v0.0.12) (2026-03-28)


### Bug Fixes

* accessibility and responsive audit fixes ([#87](https://github.com/daviseford/dueling-experts-framework/issues/87)) ([97d8d44](https://github.com/daviseford/dueling-experts-framework/commit/97d8d442d6e2fd76222e77befcdc67e212a7897d))
* address review findings from PR [#83](https://github.com/daviseford/dueling-experts-framework/issues/83) ([#88](https://github.com/daviseford/dueling-experts-framework/issues/88)) ([d6e0fab](https://github.com/daviseford/dueling-experts-framework/commit/d6e0fabe01573ce86ad45d8a10b140ee4ba45a42))
* session orchestration improvements — review enforcement, stale cleanup, context guardrails, decision dedup ([#96](https://github.com/daviseford/dueling-experts-framework/issues/96)) ([a820ce6](https://github.com/daviseford/dueling-experts-framework/commit/a820ce67ad4c436e6112b247a40f661f970b6935))

## [0.0.11](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.10...def-v0.0.11) (2026-03-27)


### Features

* UI design critique fixes ([#85](https://github.com/daviseford/dueling-experts-framework/issues/85)) ([307f866](https://github.com/daviseford/dueling-experts-framework/commit/307f866e879e29d5ada078f0345afbcff2d90844))

## [0.0.10](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.9...def-v0.0.10) (2026-03-27)


### Bug Fixes

* post-merge consistency fixes ([#82](https://github.com/daviseford/dueling-experts-framework/issues/82)) ([15b8a1b](https://github.com/daviseford/dueling-experts-framework/commit/15b8a1baa76139763e5dcf923c8d0a282638503d))
* prevent grid-mode content overflow and fix vite dev proxy port ([#80](https://github.com/daviseford/dueling-experts-framework/issues/80)) ([45a13ff](https://github.com/daviseford/dueling-experts-framework/commit/45a13ff66cb9075d85406ebddb8ade71bfeff559))

## [0.0.9](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.8...def-v0.0.9) (2026-03-26)


### Features

* UI polish — status badges, grid separation, summary card contrast ([#76](https://github.com/daviseford/dueling-experts-framework/issues/76)) ([f694fa8](https://github.com/daviseford/dueling-experts-framework/commit/f694fa8293e9bfc722751385b367923a9c7b0081))
* **ui:** add toggleable grid view for multi-session display ([#70](https://github.com/daviseford/dueling-experts-framework/issues/70)) ([cfbee36](https://github.com/daviseford/dueling-experts-framework/commit/cfbee36fc49c6b8022293a2f76b0e4f0f7faae66))

## [0.0.8](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.7...def-v0.0.8) (2026-03-26)


### Features

* add file-based IPC poll loop to orchestrator ([4f89e2f](https://github.com/daviseford/dueling-experts-framework/commit/4f89e2fab30fcda2454c20373b1a1adfa2295948))
* add file-based IPC primitives and session liveness helper ([2b3580c](https://github.com/daviseford/dueling-experts-framework/commit/2b3580cb89981f1efce49f67b5f5618b2a6ba30e))
* complete session explorer plan (Unit 11 + hook cleanup) ([f0ac4e2](https://github.com/daviseford/dueling-experts-framework/commit/f0ac4e2054892394ca85cd5859fce92b8afb7bf8))
* def explorer command, empty state, startExplorer entry point ([d20df10](https://github.com/daviseford/dueling-experts-framework/commit/d20df10d96767f53794df0fdf936eb8114cba1f0))
* def explorer command, empty state, startExplorer server entry point ([5ea921c](https://github.com/daviseford/dueling-experts-framework/commit/5ea921c26b9177d3374ea217d08896e16f62fc89))
* detect shared server and run headless when one exists ([18322e5](https://github.com/daviseford/dueling-experts-framework/commit/18322e5cdefee25b2dcef1ed71b6f48fe993548c))
* explorer detects shared server, auto-select prefers active sessions ([6c9908a](https://github.com/daviseford/dueling-experts-framework/commit/6c9908ae522623db25931d80f63f763b7466023f))
* improve session UX — liveness detection, tab persistence, model display ([#68](https://github.com/daviseford/dueling-experts-framework/issues/68)) ([c2a237d](https://github.com/daviseford/dueling-experts-framework/commit/c2a237dae21157366764a811155f1da53906c3e2))
* multi-session server API and idle timeout ([04b0c3d](https://github.com/daviseford/dueling-experts-framework/commit/04b0c3d222e222fd314191e46c082183c8a1db5b))
* multi-session server API and idle timeout ([76209bb](https://github.com/daviseford/dueling-experts-framework/commit/76209bba0d326afacba6df8170f9d1cd590e01d3))
* route interjections and end-session by session ID ([03810e8](https://github.com/daviseford/dueling-experts-framework/commit/03810e8a0058bf89a75f41a520e248762cb41c16))
* send session_id with interjection and end-session requests ([95a1395](https://github.com/daviseford/dueling-experts-framework/commit/95a13956687f906630c0c3bf903bbf5bef413910))
* session explorer frontend — tab bar, explorer hook, view-only controls ([3845380](https://github.com/daviseford/dueling-experts-framework/commit/3845380b77b6fc6c1ed66602fb44f1bfc6df6abf))
* session explorer frontend — tab bar, explorer hook, view-only controls ([7aa0269](https://github.com/daviseford/dueling-experts-framework/commit/7aa02697cbda58c8811e7a3b28605408618511db))
* session explorer Phase 1 — registry, heartbeat, liveness, explorer stub ([ebb7fd1](https://github.com/daviseford/dueling-experts-framework/commit/ebb7fd12585ff2b9f2e679c415ab0df01d4a12a5))
* session explorer Phase 1 — registry, heartbeat, liveness, explorer stub ([e22a7cc](https://github.com/daviseford/dueling-experts-framework/commit/e22a7cc4dbf40e9eac28ffb989adecb3ad124a34))
* session-aware idle timeout checks for active sessions ([6415b79](https://github.com/daviseford/dueling-experts-framework/commit/6415b7951cc5bac1cb00be1adf3ee722a2668f4e))
* shared single-server architecture with file-based IPC ([f2f1e97](https://github.com/daviseford/dueling-experts-framework/commit/f2f1e97616613c1cc58ac42421fb1c78d39fa6ad))
* wire empty state, replace deprecated polling hooks with mock explorer ([1e9713b](https://github.com/daviseford/dueling-experts-framework/commit/1e9713bd268e11c5ed0c0a0714ed58bbde7807e1))


### Bug Fixes

* DEF_NO_OPEN should not affect port selection ([ba1baf7](https://github.com/daviseford/dueling-experts-framework/commit/ba1baf70e2c51f621cdbf6577779e422ad60c3b1))
* DEF_NO_OPEN should not affect port selection, only browser opening ([1534e60](https://github.com/daviseford/dueling-experts-framework/commit/1534e60f82c02b70e3647e2e32692f36c0c55dfa))
* evaluate default port lazily to respect DEF_NO_OPEN in tests ([6dad2e6](https://github.com/daviseford/dueling-experts-framework/commit/6dad2e683f4320afe521ea9df47ebf865c99b13a))
* evict stale server + add --no-worktree flag ([#64](https://github.com/daviseford/dueling-experts-framework/issues/64)) ([114617c](https://github.com/daviseford/dueling-experts-framework/commit/114617c1cd2482993505f519ef585a27e035be3c))
* explorer UX — fixed port, single browser tab, active-only sessions ([bf15d70](https://github.com/daviseford/dueling-experts-framework/commit/bf15d70f92603e51b608a7a578df410b83965cb3))
* explorer UX — fixed port, single tab, active-only sessions ([3e9ace9](https://github.com/daviseford/dueling-experts-framework/commit/3e9ace927a8c1f49f4bca2299ba3b9c8d25d11ad))
* handle malformed IPC files, add endSession error handling, fix port default ([a8f0afc](https://github.com/daviseford/dueling-experts-framework/commit/a8f0afc1e98aea8602165ab43eac56dd50d61f18))
* lazy default port evaluation for test compatibility ([e6141a5](https://github.com/daviseford/dueling-experts-framework/commit/e6141a5ea1596191d1865ff2d2e7efa3bdc6c0a1))
* probe timeout, poll leak, UUID regex, stop cleanup, test robustness ([873e7e7](https://github.com/daviseford/dueling-experts-framework/commit/873e7e7b18fea665354d7021998d869e969c6944))
* resolve PR base branch from topic URL ([af1b264](https://github.com/daviseford/dueling-experts-framework/commit/af1b26465bd6508cd4b7fae1abfa633c00ddb301))
* resolve PR base branch from topic URL ([9c4467c](https://github.com/daviseford/dueling-experts-framework/commit/9c4467c1e0eb711822fd207cab7d2be3ecb07ead))
* resolve session liveness in turns endpoints and prioritize status update on SIGINT ([#69](https://github.com/daviseford/dueling-experts-framework/issues/69)) ([71a26b8](https://github.com/daviseford/dueling-experts-framework/commit/71a26b849c1a21c9ad458c814ebd3c0c2df8e804))
* review findings — eviction, port handling, dead code cleanup ([e4d9919](https://github.com/daviseford/dueling-experts-framework/commit/e4d9919eb1342fb30b7a0f0793cbc41c6a4d3ab1))

## [0.0.7](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.6...def-v0.0.7) (2026-03-25)


### Features

* add ASCII-safe punctuation rule to prompt templates ([#30](https://github.com/daviseford/dueling-experts-framework/issues/30)) ([b988406](https://github.com/daviseford/dueling-experts-framework/commit/b988406bfa878ea53790b1d42cc8106c77c5496d))
* add session history browsing (def history, def show) ([8a8612c](https://github.com/daviseford/dueling-experts-framework/commit/8a8612c69b6b181512779071145102d6e3a2951a))
* pending interjection UI + session ID in nav bar ([cf3877d](https://github.com/daviseford/dueling-experts-framework/commit/cf3877d56ed1b6ec9760884b03dac52054708e09))
* show pending interjections inline in transcript ([0489979](https://github.com/daviseford/dueling-experts-framework/commit/0489979624433f7bfb640c5ac098364140c699c4))
* show session ID in the top nav bar ([f9525f3](https://github.com/daviseford/dueling-experts-framework/commit/f9525f36730556cae333e630a7adb100c87a7013))
* use Sonnet for review-phase turns (three-tier model system) ([#49](https://github.com/daviseford/dueling-experts-framework/issues/49)) ([b71d696](https://github.com/daviseford/dueling-experts-framework/commit/b71d6966c92966ab87b8402336bd01fc88fc778c))


### Bug Fixes

* address remaining PR [#28](https://github.com/daviseford/dueling-experts-framework/issues/28) review feedback ([0c4db02](https://github.com/daviseford/dueling-experts-framework/commit/0c4db029d05d9f50fc1c904847ce29a23f51d9ad))
* address review findings for pending interjection UI ([20ec75b](https://github.com/daviseford/dueling-experts-framework/commit/20ec75bb9cf045fb81e59b3bb54f1bd8d7d3d55a))
* address session history review feedback ([28b10b2](https://github.com/daviseford/dueling-experts-framework/commit/28b10b278a0378dc793a69dd2d165dd4a2ffeb70))
* rescue agent branch switches and handle deleted base_ref in PR creation ([#51](https://github.com/daviseford/dueling-experts-framework/issues/51)) ([91db86d](https://github.com/daviseford/dueling-experts-framework/commit/91db86d58f3906dd86827e05450166f5096e5393))
* restore CI/DEF_NO_OPEN guard in start() and validate dates early ([166e9d6](https://github.com/daviseford/dueling-experts-framework/commit/166e9d6e18d42940c4b3e7b7f029c3f2921de560))

## [0.0.6](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.5...def-v0.0.6) (2026-03-25)


### Features

* show model name on turn cards and add Key Implementations to session summary ([#46](https://github.com/daviseford/dueling-experts-framework/issues/46)) ([a44487e](https://github.com/daviseford/dueling-experts-framework/commit/a44487ebdf62b51467f02ca84aeab467e3bdc791))

## [0.0.5](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.4...def-v0.0.5) (2026-03-25)


### Bug Fixes

* replace unsupported o4-mini with gpt-5.1-codex-mini for Codex fast tier ([#42](https://github.com/daviseford/dueling-experts-framework/issues/42)) ([1318b62](https://github.com/daviseford/dueling-experts-framework/commit/1318b629956ec5b40abe20b802f5e6fc2e30a52d))

## [0.0.4](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.3...def-v0.0.4) (2026-03-25)


### Features

* grant plan/review agents read-only tool access ([#40](https://github.com/daviseford/dueling-experts-framework/issues/40)) ([7ac9c11](https://github.com/daviseford/dueling-experts-framework/commit/7ac9c117dcb471447ea1b29d8dff1a52b16dbec4))
* optimize Codex invocation with --ephemeral and read-only reviewArgs ([#41](https://github.com/daviseford/dueling-experts-framework/issues/41)) ([7972b7e](https://github.com/daviseford/dueling-experts-framework/commit/7972b7e217535f756304a6afb7a750fdbc3c4a3f))


### Bug Fixes

* add reviewArgs for gh CLI access and fix process tree kill on Windows ([#37](https://github.com/daviseford/dueling-experts-framework/issues/37)) ([7331ead](https://github.com/daviseford/dueling-experts-framework/commit/7331ead94dbdeb92f9c09cc1ef68e82a9e0e9a08))

## [0.0.3](https://github.com/daviseford/dueling-experts-framework/compare/def-v0.0.2...def-v0.0.3) (2026-03-25)


### Features

* adaptive model tiering for plan-phase turns ([deae09a](https://github.com/daviseford/dueling-experts-framework/commit/deae09a1068ce1a2f73b3231f09678eb043ee67a))
* adaptive model tiering for plan-phase turns ([2e42c6a](https://github.com/daviseford/dueling-experts-framework/commit/2e42c6a12d7524d414537e21e2aab20fe0c112fc))
* add collapse/expand all toggle, move theme picker to status bar ([d0787d1](https://github.com/daviseford/dueling-experts-framework/commit/d0787d1b7d1c66fc265915da52482dd7cf0e52a7))
* add debate-then-implement session lifecycle ([1170022](https://github.com/daviseford/dueling-experts-framework/commit/117002245d64356f7176f26c15f1be7b9e154ce0))
* add dev:ui:mock script to auto-enable mock mode ([92015e6](https://github.com/daviseford/dueling-experts-framework/commit/92015e6c99f44b487a852751d41e564e2de24318))
* add git worktree isolation for concurrent sessions ([0ef60d5](https://github.com/daviseford/dueling-experts-framework/commit/0ef60d58c43df9424676343c958373cffab29263))
* auto-open browser when watcher UI starts ([ba74138](https://github.com/daviseford/dueling-experts-framework/commit/ba7413865bb1324e11bc32817f825d40070e1e48))
* git worktree isolation for concurrent sessions ([5e0bbad](https://github.com/daviseford/dueling-experts-framework/commit/5e0bbad6d3ef99803be6ccb71c35aa2004998006))
* implement Phase 1 core loop — headless agent collaboration ([2469ef1](https://github.com/daviseford/dueling-experts-framework/commit/2469ef1b71970a3551ac3cc0c9c30f3777c87c3a))
* implement Phase 2 watcher UI + human-in-the-loop ([5a1e7de](https://github.com/daviseford/dueling-experts-framework/commit/5a1e7de2219c13b6e74b0593b6e5dae482ee75ee))
* implement Phase 3 crash recovery ([2656b91](https://github.com/daviseford/dueling-experts-framework/commit/2656b91b1c65c478ad6dfcc88895b1fe3372dc41))
* replace def-action blocks with native agent execution ([9d5a610](https://github.com/daviseford/dueling-experts-framework/commit/9d5a61077f1cb5a740ed3ac700ffaec032dbe3ee))
* replace def-action blocks with native agent execution ([efd2749](https://github.com/daviseford/dueling-experts-framework/commit/efd27493fecb5ddda6e9972e777fc899a47b4b78))
* show thinking indicator in UI while agent is generating ([6121a0d](https://github.com/daviseford/dueling-experts-framework/commit/6121a0d6dfd5cd406df96e15574f277d1847408c))
* simplify summary card — dirs only, bump label opacity ([41f1871](https://github.com/daviseford/dueling-experts-framework/commit/41f18713af402b9e1b11d5e970c1d6410b131fa0))
* simplify summary card — dirs only, bump label opacity ([ee88778](https://github.com/daviseford/dueling-experts-framework/commit/ee8877880cde24625114b0853b16fee3c7779b19))
* support multiple concurrent sessions ([1c67892](https://github.com/daviseford/dueling-experts-framework/commit/1c67892db16531b00ffcbd4d340e686d798cd981))
* UI polish — collapse toggle, theme picker, summary cleanup ([98670ec](https://github.com/daviseford/dueling-experts-framework/commit/98670ecc237b98a96596e7e4ccf7640755910b04))
* **ui:** add all watcher UI components with shadcn/ui ([7bb3d5d](https://github.com/daviseford/dueling-experts-framework/commit/7bb3d5d75fa5f63f97bd3e9328e5deba926b87f5))
* **ui:** add collapse button at bottom of each turn card ([9536bf7](https://github.com/daviseford/dueling-experts-framework/commit/9536bf763c5240fac7a6bce42b391437e0baf358))
* **ui:** add collapsible turns, shadcn spinner, enhanced status bar ([c85c622](https://github.com/daviseford/dueling-experts-framework/commit/c85c62216312f6ace0daa0721f1cad2925fc086b))
* **ui:** make status bar stats more prominent ([e341e2e](https://github.com/daviseford/dueling-experts-framework/commit/e341e2e7c785b2c8b1bc7be4b65a4ef5c4a8c799))
* **ui:** redesign with refined terminal dashboard aesthetic ([9c4f59b](https://github.com/daviseford/dueling-experts-framework/commit/9c4f59b640aba3781df5b2e3964835dfe195cb0d))
* **ui:** render turn content as markdown, fix scroll containment ([d29ad35](https://github.com/daviseford/dueling-experts-framework/commit/d29ad3544302034013ee8191ae629f5635a263a0))
* **ui:** scaffold Vite + React + TypeScript + shadcn/ui project ([6aff6e6](https://github.com/daviseford/dueling-experts-framework/commit/6aff6e64a17f09ae2b7f8b6439610d0d54c3f934))
* **ui:** wire polling hook and integrate all components in App ([e8979b2](https://github.com/daviseford/dueling-experts-framework/commit/e8979b29c5dd710d44a0dd81714ed0b9baf4504f))


### Bug Fixes

* add error logging, fix stdin piping, fix UI connecting state ([47358df](https://github.com/daviseford/dueling-experts-framework/commit/47358df8b1ba21fd193d75003cde90dff757df5c))
* address code simplicity review findings (P1-P3) ([de5d886](https://github.com/daviseford/dueling-experts-framework/commit/de5d8866e2aa010289cfc5d9645073beec5cf80a))
* address P1/P2 review findings ([3bf5f62](https://github.com/daviseford/dueling-experts-framework/commit/3bf5f62a44aa7ba0ea795251afd4047a012c651a))
* address review feedback on draft PR feature ([ab3a225](https://github.com/daviseford/dueling-experts-framework/commit/ab3a22516a95099f0db844df7a7d4db49f1d3a98))
* address review feedback on ui.ts — clack.intro, NO_COLOR fallback, ASCII symbols ([1a041f5](https://github.com/daviseford/dueling-experts-framework/commit/1a041f51613779691b16ef2fc9a6a05da5264c39))
* address review findings for native agent execution ([4569445](https://github.com/daviseford/dueling-experts-framework/commit/456944538ce6ae5bc6b61b2bb1ee93aaa3b07f7d))
* address review findings for worktree isolation ([1c91077](https://github.com/daviseford/dueling-experts-framework/commit/1c910772f96ce22daea305789c10f803f53f0def))
* address review gaps — add phase to summary card, preserve raw decisions log, add endpoint test ([09928b7](https://github.com/daviseford/dueling-experts-framework/commit/09928b700433807935da2da9575d1671e6823048))
* address review round 2 findings ([e54dbe2](https://github.com/daviseford/dueling-experts-framework/commit/e54dbe2fed91129fe349bf11efc3971aa2e7c885))
* address round 2 review findings ([028a1a8](https://github.com/daviseford/dueling-experts-framework/commit/028a1a8f242105946762e86cdb37508282e60363))
* address security review round 2 findings ([65aa47c](https://github.com/daviseford/dueling-experts-framework/commit/65aa47c35df121a21ef5ec9fc3d6c74b26d50279))
* address security, architecture, and frontend review findings ([814a377](https://github.com/daviseford/dueling-experts-framework/commit/814a3773ffd152a7341da7d5f311222cad59f599))
* always auto-scroll to bottom when new turns arrive ([cd9abb2](https://github.com/daviseford/dueling-experts-framework/commit/cd9abb2a86aa8fb9ebc851f1dec50be3ba0daec6))
* coerce YAML-parsed decision objects to strings ([5dcf084](https://github.com/daviseford/dueling-experts-framework/commit/5dcf084333b82bf69036378d8e8afe8c327af0c2))
* convert Windows paths to file:// URLs in bin/acb entry point ([282cf7f](https://github.com/daviseford/dueling-experts-framework/commit/282cf7f2a570c604acc6febfd0e8191d78591f8d))
* ensure turns/ directory exists before writing (defensive mkdir) ([edebc86](https://github.com/daviseford/dueling-experts-framework/commit/edebc86d64c088a681ce872e84662b3c6bb65b1d))
* escalate fast→full model on invocation failure ([30af05f](https://github.com/daviseford/dueling-experts-framework/commit/30af05f1714d3d51975319fd3452ae43ec52cb31))
* escalate fast→full model on invocation failure and capture more stderr ([24d3db5](https://github.com/daviseford/dueling-experts-framework/commit/24d3db5a23ee44d1114ffa7099701499f49d2480))
* exit process on fatal orchestrator error instead of hanging ([14eaecf](https://github.com/daviseford/dueling-experts-framework/commit/14eaecfa1a29aedb9240ac1308621b02d34f14e1))
* extract frontmatter from anywhere in agent output, not just line 1 ([25171c8](https://github.com/daviseford/dueling-experts-framework/commit/25171c8b94b4b31f6257f8cea7f9584a5d22a2e6))
* harden worktree path validation and recovery safety ([58df473](https://github.com/daviseford/dueling-experts-framework/commit/58df4734c79cb169fea2a41e1fcc5e055239df5d))
* list test files explicitly for Windows compatibility ([c177fbf](https://github.com/daviseford/dueling-experts-framework/commit/c177fbf5a49b91cc564fecd72ce1e47a450f0b99))
* move misplaced JSDoc comment to correct function in util.ts ([48d7e50](https://github.com/daviseford/dueling-experts-framework/commit/48d7e50b1e27fc05db1a3b9652d254343114fa3f))
* move schedulePoll() into finally block so polling survives early returns ([4b30a18](https://github.com/daviseford/dueling-experts-framework/commit/4b30a1873647d5485b896abad49d7c4a63d5f7fe))
* prevent agents from ending session on turn 1 ([44d0502](https://github.com/daviseford/dueling-experts-framework/commit/44d0502e78fbd7f5bf4775d7e176d2397d9c6f57))
* print artifact paths and session directory on completion ([626a033](https://github.com/daviseford/dueling-experts-framework/commit/626a0334bc9c04135750e293407f3d1183d0efec))
* recover from YAML-breaking characters in decision list items ([be04821](https://github.com/daviseford/dueling-experts-framework/commit/be04821d44e99f3e12305828c87b9e073335d52b))
* recovery correctness and state integrity (Phase 1) ([ee14d8b](https://github.com/daviseford/dueling-experts-framework/commit/ee14d8bc4bca5095bdcd7a1f5cc6b4d16be42390))
* remove invalid --no-project-doc flag from Codex invocation ([5c4dbb9](https://github.com/daviseford/dueling-experts-framework/commit/5c4dbb9c5427bec5981376c75f298b9968e05eb5))
* remove unused artifactNames prop from SessionSummary ([f49a75c](https://github.com/daviseford/dueling-experts-framework/commit/f49a75c975beb2a343337448e4d4ba75b4263f8c))
* resolve 12 inconsistencies found by Codex review (3 P1, 9 P2) ([679eaa7](https://github.com/daviseford/dueling-experts-framework/commit/679eaa730aa6ffbc1cd0d518d3f48cc27d3998fa))
* resolve CI test failures on Ubuntu and Windows ([2f63345](https://github.com/daviseford/dueling-experts-framework/commit/2f633450817e87847797f2e624789d0bd165ce9f))
* restore writeFile import needed by savePromptForTurn ([9ecd38f](https://github.com/daviseford/dueling-experts-framework/commit/9ecd38f0a5d7341fbe0749b4bbc33f5da94e2abb))
* revert to createReadStream pipe for stdin, increase timeout to 180s ([0daa17c](https://github.com/daviseford/dueling-experts-framework/commit/0daa17c7ea3b6891258db4b4688e2576a4d4cb0b))
* review round 2 - bug fixes and cleanup ([cbc4a31](https://github.com/daviseford/dueling-experts-framework/commit/cbc4a31f1bac697053ee64f2a12273599a6e6432))
* show waiting message in UI while first agent turn is generating ([cf11d45](https://github.com/daviseford/dueling-experts-framework/commit/cf11d454159f8ffd64588949377740e7d0f2141c))
* smarter frontmatter extraction — require from: and status: keys ([e860ac3](https://github.com/daviseford/dueling-experts-framework/commit/e860ac3eca8199e7099bc36ad53ad88b453449ec))
* suppress DEP0190 warning and improve CLI banner contrast ([ae50332](https://github.com/daviseford/dueling-experts-framework/commit/ae50332d383fffc613316a0ba8aa0dde637eee4b))
* **ui:** detect server shutdown and show session ended state ([677fe59](https://github.com/daviseford/dueling-experts-framework/commit/677fe59234815af67919001646b62900abc8bfb5))
* **ui:** only auto-scroll on new turns or thinking state changes ([85b2d5a](https://github.com/daviseford/dueling-experts-framework/commit/85b2d5aa0597d696040a919408be6ec9e7bf62c0))
* update AGENTS.md for three-phase lifecycle, misc P2 fixes ([f0159ca](https://github.com/daviseford/dueling-experts-framework/commit/f0159ca58b82d830e709fecc5d154a7bafd8859f))
* use platform-aware process kill for end-session on Windows ([7ee6d66](https://github.com/daviseford/dueling-experts-framework/commit/7ee6d669850c8c45a97ce6b89e96c58f0b0f4de7))
* use shell on Windows for npm-installed CLI shims (.cmd) ([d0c31ad](https://github.com/daviseford/dueling-experts-framework/commit/d0c31ad437055ae80d285598710364e634bb5288))
* use tsx/esm import in bin/def for Windows compatibility ([cf69266](https://github.com/daviseford/dueling-experts-framework/commit/cf6926676941910055edb6ac41e392f092ddd0d6))
* validate retry status in review decided-without-verdict path ([6010920](https://github.com/daviseford/dueling-experts-framework/commit/60109207a69e391b65b347d5c0375b7a3b572fd5))
* wrap test cleanup in try/catch for Windows EPERM errors ([d3a604c](https://github.com/daviseford/dueling-experts-framework/commit/d3a604c23cac9555980b8c28b46f3da4ea7a8e7f))


### Reverts

* **ui:** remove markdown rendering, show raw text ([eecfafa](https://github.com/daviseford/dueling-experts-framework/commit/eecfafa269941397d1e2ed184cde6cd77be3b584))
