# Changelog

## [0.13.0](https://github.com/baz-scm/baz-plugin/compare/v0.12.1...v0.13.0) (2026-08-18)


### Features

* **plan:** restore cross-repo attribution and tighten the plan schema ([#37](https://github.com/baz-scm/baz-plugin/issues/37)) ([cc60fc4](https://github.com/baz-scm/baz-plugin/commit/cc60fc4d63f851121f9cfa126968106dad758e18))


### Bug Fixes

* **hooks:** keep short-form repo names on the plan upload ([#39](https://github.com/baz-scm/baz-plugin/issues/39)) ([6aeb00a](https://github.com/baz-scm/baz-plugin/commit/6aeb00a7f17e6917eb5a776409cb7d3b858d683d))

## [0.12.1](https://github.com/baz-scm/baz-plugin/compare/v0.12.0...v0.12.1) (2026-08-18)


### Bug Fixes

* **hooks:** private scratch dir, Codex data loss, and hook tests ([#34](https://github.com/baz-scm/baz-plugin/issues/34)) ([90eb48a](https://github.com/baz-scm/baz-plugin/commit/90eb48af62edec0b500ec1ce0193f3e2fd122cc0))

## [0.12.0](https://github.com/baz-scm/baz-plugin/compare/v0.11.0...v0.12.0) (2026-08-18)


### Features

* **plan:** CR-4980 link the plan to the PR that implements it ([#30](https://github.com/baz-scm/baz-plugin/issues/30)) ([4cb791c](https://github.com/baz-scm/baz-plugin/commit/4cb791cd33b7d67f3f120c904ce954389965fcec))

## [0.11.0](https://github.com/baz-scm/baz-plugin/compare/v0.10.0...v0.11.0) (2026-08-17)


### Features

* **plan:** plan without harness plan mode, and stop hooks exiting non-zero ([#32](https://github.com/baz-scm/baz-plugin/issues/32)) ([f5e2964](https://github.com/baz-scm/baz-plugin/commit/f5e2964847d13c755a8302b1ec3dbf2a78e85098))

## [0.10.0](https://github.com/baz-scm/baz-plugin/compare/v0.9.0...v0.10.0) (2026-08-16)


### Features

* **plan:** CR-4885 restructure the plan for a human reader ([#29](https://github.com/baz-scm/baz-plugin/issues/29)) ([d9d33af](https://github.com/baz-scm/baz-plugin/commit/d9d33af0ea4f7227ac56be53793bfe000e7fa4ef))

## [0.9.0](https://github.com/baz-scm/baz-plugin/compare/v0.8.0...v0.9.0) (2026-08-13)


### Features

* add the /baz:plan-comments skill ([#27](https://github.com/baz-scm/baz-plugin/issues/27)) ([b448f46](https://github.com/baz-scm/baz-plugin/commit/b448f464f4ee0d9c14616930abf7a2a9a87d8f2e))

## [0.8.0](https://github.com/baz-scm/baz-plugin/compare/v0.7.0...v0.8.0) (2026-08-12)


### Features

* **plan:** attach the plan to update_plan instead of re-typing it ([#25](https://github.com/baz-scm/baz-plugin/issues/25)) ([f40fee5](https://github.com/baz-scm/baz-plugin/commit/f40fee59526271da025c216948349802ee766111))

## [0.7.0](https://github.com/baz-scm/baz-plugin/compare/v0.6.0...v0.7.0) (2026-08-09)


### Features

* **plan:** CR-4972 require user consent before uploading a plan to Baz ([#23](https://github.com/baz-scm/baz-plugin/issues/23)) ([f7c2735](https://github.com/baz-scm/baz-plugin/commit/f7c2735ec205399dc7b173248d9ec27e1d9102a4))

## [0.6.0](https://github.com/baz-scm/baz-plugin/compare/v0.5.1...v0.6.0) (2026-07-27)


### Features

* **review:** add /baz:review code review command ([#19](https://github.com/baz-scm/baz-plugin/issues/19)) ([675e8f4](https://github.com/baz-scm/baz-plugin/commit/675e8f47f5b495fa2d4a2fd37583645f79df7ae8))

## [0.5.1](https://github.com/baz-scm/baz-plugin/compare/v0.5.0...v0.5.1) (2026-07-20)


### Bug Fixes

* CR-4785 Change plan trigger ([#16](https://github.com/baz-scm/baz-plugin/issues/16)) ([3219b36](https://github.com/baz-scm/baz-plugin/commit/3219b361e850f6acfd7492c6f65704cecae67b72))

## [0.5.0](https://github.com/baz-scm/baz-plugin/compare/v0.4.0...v0.5.0) (2026-07-07)


### Features

* **planner:** Some changes to baz plugin ([#13](https://github.com/baz-scm/baz-plugin/issues/13)) ([70a25b6](https://github.com/baz-scm/baz-plugin/commit/70a25b6fcd0a7555623790bf8d048815a98976ea))

## [0.4.0](https://github.com/baz-scm/baz-plugin/compare/v0.3.0...v0.4.0) (2026-07-05)


### Features

* **planner:** CR-4545 Agent vendor ([#11](https://github.com/baz-scm/baz-plugin/issues/11)) ([723136b](https://github.com/baz-scm/baz-plugin/commit/723136b50b82f067bfb3043756aec66202181fe7))

## [0.3.0](https://github.com/baz-scm/baz-plugin/compare/v0.2.2...v0.3.0) (2026-06-30)


### Features

* add /baz:plan-with-baz planning command skill ([#8](https://github.com/baz-scm/baz-plugin/issues/8)) ([6248068](https://github.com/baz-scm/baz-plugin/commit/6248068161f4c963e7981f92afaf1462ba1ec064))
* **planner:** CR-4545 Add 2 more hooks to extract session and repo and send session complete ([#9](https://github.com/baz-scm/baz-plugin/issues/9)) ([ecb40b6](https://github.com/baz-scm/baz-plugin/commit/ecb40b6ab92a048acfda64f6e064bbf9910fbf88))

## [0.2.2](https://github.com/baz-scm/baz-plugin/compare/v0.2.1...v0.2.2) (2026-06-23)


### Bug Fixes

* Remove bad mcp headers ([#6](https://github.com/baz-scm/baz-plugin/issues/6)) ([315950b](https://github.com/baz-scm/baz-plugin/commit/315950b7601130b67469fd689080be1f7d3496f2))

## [0.2.1](https://github.com/baz-scm/baz-plugin/compare/v0.2.0...v0.2.1) (2026-06-22)


### Bug Fixes

* CR-4273 Change tool name ([#3](https://github.com/baz-scm/baz-plugin/issues/3)) ([6546fb7](https://github.com/baz-scm/baz-plugin/commit/6546fb7b5577880d8273e3deb28cec588762eab3))
* update plugin.json URLs ([#5](https://github.com/baz-scm/baz-plugin/issues/5)) ([ec733a9](https://github.com/baz-scm/baz-plugin/commit/ec733a9bd84c2f6edecc6320e9abacee79ea87dc))

## [0.2.0](https://github.com/baz-scm/baz-plugin/compare/v0.1.0...v0.2.0) (2026-06-22)


### Features

* Add hooks for Claude Code, Codex and Cursor ([#1](https://github.com/baz-scm/baz-plugin/issues/1)) ([557acb0](https://github.com/baz-scm/baz-plugin/commit/557acb00943783852d75aab8da7ebe82a6ff758c))
