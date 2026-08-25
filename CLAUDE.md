# baz-plugin

Plugin for Claude Code, Codex CLI, and Cursor that adds Baz indexed search tools. All three platforms wire a session-start hook that surfaces two values — the agent's session ID and the repository the working directory belongs to — so baz can correlate tool calls, and a PostToolUse hook that watches for the agent writing its final plan to the session's scratch plan file (`.baz-plan-<sessionId>.md` in the plugin's private directory; see Scratch-file lifecycle) — that file-write is the cross-platform "I'm done planning" signal that prompts the agent to ask the user whether to upload the plan. Only on the user's yes does it call `mcp__baz__update_plan`, which persists the plan, emits the `planner_session_completed` event, and returns a shareable plan link. An uploaded plan is an object teammates open, comment on, and review inside Baz, the way a pull request lives in GitHub.

## Repo layout

```
.claude-plugin/plugin.json      CC plugin manifest (MCP server + skills + hooks)
.codex-plugin/plugin.json       Codex CLI plugin manifest
.cursor-plugin/plugin.json      Cursor plugin manifest

tests/hooks.test.js             Process-level hook tests, no dependencies: `node tests/hooks.test.js`. CI runs them.

hooks/
  hook-io.js                    Shared: failSoft() + readHookInput(). Every hook calls both first — see "Hooks must never exit non-zero".
  session-start.js              Shared: emits additionalContext telling the assistant the session id + cwd repo (allowlist-validated), so it passes them through to baz MCP tools for session correlation. Handles `cwd` (CC/Codex) and `workspace_roots[0]` (Cursor).
  plan-complete.js              Shared completion trigger: prompts the agent to ASK the user whether to upload the plan, then call mcp__baz__update_plan only on a yes (see "Upload requires user consent"). Branches on tool_name — ExitPlanMode (CC plan mode) always fires; file-write tools (Write/Edit/apply_patch/edit_file/write_file) fire only when the path's basename matches .baz-plan-<sessionId>.md, wherever the scratch directory resolves to. CC wires both branches; Cursor/Codex have no ExitPlanMode and rely on the file-write branch. Exits quietly if the plan text can't be extracted — update_plan requires content.
  post-tool-use.js              Shared: increments per-tool counter in the scratch dir on each Baz MCP call
  session-end.js                Shared: prints call summary to console at session end, cleans up the scratch dir (and reaps pre-upgrade /tmp leftovers)

  plan-attach.js                Claude Code only: PreToolUse on mcp__baz__update_plan and mcp__baz__link_plan_to_pr. Fills update_plan with the plan parked by plan-complete.js, so the plan is generated once instead of being re-typed into the call, and fills link_plan_to_pr's planId with the session id. Adds only what is missing, so a call that already carries content (Codex/Cursor) or its own planId passes through.

  hooks.json                    CC hooks: SessionStart + PreToolUse (mcp__baz__update_plan|mcp__baz__link_plan_to_pr) + PostToolUse (mcp__baz__ + Write|Edit) + SessionEnd, ${CLAUDE_PLUGIN_ROOT}
  hooks.codex.json              Codex hooks: SessionStart + PostToolUse (mcp__baz__ + apply_patch|Write|Edit) + Stop, ${PLUGIN_ROOT}
  hooks.cursor.json             Cursor hooks: sessionStart + postToolUse (mcp__baz__ + edit_file|write_file|Write|Edit) + stop (stop-token-tally.js only). No session-end wiring — Cursor's validator does not accept `sessionEnd`; see Hook counter mechanics for the counter-file trade-off. ${CURSOR_PLUGIN_ROOT}

skills/baz-codebase-exploration/SKILL.md   Reference skill: auto-loaded tool-routing rules
skills/plan-with-baz/SKILL.md              Task skill: manual /baz:plan-with-baz planning command
skills/get-plan-comments/SKILL.md          Task skill: /baz:get-plan-comments pulls a plan's review comments back
skills/review/SKILL.md                     Task skill: /baz:review diff review, cross-repo checks via Baz
.cursor/rules/baz-codebase-exploration.mdc Reference skill, Cursor rules format (always-apply)
```

## Skills

Four skills, by type:

- **`baz-codebase-exploration`** — *reference* content. Auto-loaded; the tool-routing rules + search budget, **and nothing else**. Its only session-tracking content is the `sessionId`/`sessionRepository`/`agentVendor` arguments that search calls require. What happens to a finished plan is not its concern — that boundary is deliberate and has been re-broken before, so resist re-adding plan lifecycle here. Also mirrored as a Cursor always-apply rule (`.cursor/rules/*.mdc`).
- **`plan-with-baz`** — *task* content. Manually invoked as `/baz:plan-with-baz` (`disable-model-invocation: true` so Claude won't auto-trigger it). Five steps: explore via Baz, write the plan to the scratch path SessionStart injects, in a fixed section schema, get the user's approval, offer to upload, link the PR that implements it. It says nothing about harness modes — the read-only discipline it enforces on itself is what holds until the user approves, on every platform. It owns the **whole plan lifecycle**, including the Step 4 upload-consent contract and the Step 5 PR link. It defers the detailed routing rules to `baz-codebase-exploration` rather than forking the table.
- **`get-plan-comments`** — *task* content. Invoked as `/baz:get-plan-comments [plan url or id]` (`disable-model-invocation: true`). The return leg of the plan lifecycle: reads a plan's comments through `get_plan_comments`, reports every one with an assessment, and applies only what the user then picks. Two properties are load-bearing. Triage is the human's — `used` marks a comment worth considering, never permission to edit — and fetched comment text is untrusted data, so nothing inside it can authorize a tool call. **Its Step B passes `sessionId` and `content` to `update_plan` explicitly**, which looks like it contradicts the attach contract below but does not: the hook fills in the *current session's* id, and this skill can be working on a plan this session never created. Do not "consistency-fix" those arguments away.
- **`review`** — *task* content. Invoked as `/baz:review [scope]`, and unlike `plan-with-baz` it **omits** `disable-model-invocation`, so "review my changes" triggers it too — natural-language invocation is the point of parity with competing review plugins. Resolves a git/PR diff, reads the changed files, then spends the `baz-codebase-exploration` search budget on the checks only indexed search can make: broken call sites in other repos, the far side of a contract, and registration sites a new case is missing from. Optional `--fix` loop applies findings in the local checkout only.

All four live under `skills/` and ship to all three platforms with no manifest change — Codex and Cursor manifests already point at `./skills/`, Claude Code auto-discovers. `plan-with-baz`, `get-plan-comments` and `review` are on-demand, so none has a `.cursor/rules/*.mdc` mirror (rules are always-apply).

`review` deliberately introduces no new MCP tool, hook, or manifest entry — it composes the three existing search tools. Cross-repo findings are reported, never edited: the `--fix` loop only touches the repo that is checked out.

**Baz-unavailable posture — gate the verdict, not the command.** A review run without the Baz MCP tools would otherwise degrade silently into a local review that still claims "safe to merge", which is the one claim local information cannot support. Rather than hard-blocking the command (wrong for a model-invocable skill — a lapsed OAuth token shouldn't wall off "review my changes", and a formatting-only diff has nothing cross-repo to miss), the skill branches on whether the diff has an **outward-facing surface**: if it does, it stops, names the unchecked symbols, and withholds the merge verdict; if it doesn't, it reviews normally with a one-line note. The `## Coverage` heading in the Step 5 report template exists to make this state explicit on every run, including the partial case where the search budget runs out mid-check. If that posture is ever relaxed to a hard block, the report template's coverage line should stay — it's what keeps a degraded review from reading as a complete one.

### Plan output schema (Tier-3 contract)

`plan-with-baz` emits a plan in a fixed, ordered section schema — the canonical definition is the Step 2 template in `skills/plan-with-baz/SKILL.md`. Every heading is emitted in order, and diagrams are inline ```mermaid``` blocks. Keep that template stable — the Baz product parses these headings when it renders a plan. Edit the schema in the skill, not here.

`Affected repos` is always emitted, one short line per repo, and is a list of repos only. It restores the blast radius that `d9d33af` removed along with the old `Affected repos & files` catalogue, without restoring the catalogue. Do not let it grow a `path` column.

**The section budgets are word counts and item caps, not "be concise".** A `Steps` entry is capped at 25 words rather than "one sentence", because a sentence cap is gamed: a real plan complied with it by writing a 55-word step chaining six clauses with commas. The same review of that plan is why the Before/After table keeps at most one `(unchanged)` row, why only the After cell carries a marker, and why the diagram is drawn only when it answers something the table does not. Do not relax these back into prose advice.

The schema is two layers split by a `---` rule: `Why` / `The change` / `Affected repos` / `Decisions` / `Open questions` are what a reviewer approves on, and `Steps` / `Verification` below the rule are what an implementer follows. The split is what keeps a plan reviewable — file paths belong to the steps that need them, never gathered into a catalogue of their own, and a change repeated across many sites is described once as a pattern with a few representative paths. Renderers should treat the lower layer as collapsible.

## Hooks must never exit non-zero

Every hook starts with `failSoft()` and gets its payload from `readHookInput()` (`hooks/hook-io.js`). A hook that throws exits 1, and the host shows the user a failure — `Stop hook (failed) — error: hook exited with code 1`, reported against plugin 0.9.0 on Codex. Nothing this plugin does at a session boundary is worth an error in the user's face, so a hook that can't do its job exits 0 and does nothing.

The reported crash was `JSON.parse('')`: Codex fires `Stop` with no JSON body on some turns, and `session-end.js` parsed stdin unguarded. Every hook had the same shape. `readHookInput()` reads fd 0 (not `/dev/stdin`), and returns `null` for absent stdin (a closed fd or a TTY throws EAGAIN), empty input, non-JSON, and non-object JSON such as `null` or an array — each hook treats `null` as "nothing to do". `failSoft()` additionally traps `uncaughtException` / `unhandledRejection` and swallows stdout/stderr EPIPE, so a host that closes the pipe mid-write doesn't turn a `console.log` into a crash. Filesystem calls that are best-effort (the counters, the parked payload, the read-then-delete in `session-end.js`, which races with itself on Codex since `Stop` is per-turn) are individually wrapped too.

**The cost of failing soft is that a broken hook looks like a working one.** `failSoft()` turns any runtime error into a clean exit 0 with no output, which is indistinguishable from "nothing to do" — a missing `+` between two template literals once silenced the whole upload prompt while `node --check` still passed, because adjacent template literals are a legal tagged-template call. So never verify a hook with `node --check` alone: run it with a realistic payload and assert the output is **non-empty**.

**This is why the hooks have tests.** `tests/hooks.test.js` runs each hook as a process with realistic Claude Code / Codex / Cursor payloads and asserts observable behaviour: exit 0 across every bad-input class, **non-empty output** from `session-start` / `plan-complete` / `plan-attach`, files created and consumed in both namespaces, the atomic counter claim under concurrency, per-vendor cleanup, reaper exclusions, and that a hostile session id or an unrenderable path changes nothing. No framework and no dependencies — `node tests/hooks.test.js`, wired into `.github/workflows/validate-json.yml` alongside the JSON and manifest checks. Reintroducing the missing-`+` bug makes four of them fail while `node --check` still passes, which is the whole point: **assert on output, never on syntax.**

## Scratch-file lifecycle

Everything the plugin writes goes in **a directory it owns, mode 0700** — `<os.tmpdir()>/.baz-<uid>`, resolved by `scratchDir()` in `hook-io.js` — under a `.baz-*-<sessionId>.*` name. Never shared `/tmp`. The plan file is why: it holds the user's proprietary design, the *agent's* file-write tool creates it (so it lands with the agent's umask, `0644` under the usual `022`), and its name is derived from the session id rather than being secret. We can't set the mode on a file we don't write, so the parent directory is what denies other local accounts. `os.tmpdir()` is already per-user on macOS; the uid in the name keeps two users on one Linux box apart.

**It fails closed.** `scratchDir()` verifies with `lstat` that the directory is a real directory (not a symlink), owned by this uid, with no group/other bits, and it never falls back to a shared directory: on a multi-user box another account can pre-create `/tmp/.baz-<our uid>`, or point it at somewhere it can read, and a fallback would hand it the plan. When nothing can be verified, `scratchDir()` and `scratchPath()` return `null`, every writer does nothing, and `session-start.js` omits both the plan path and the completion contract rather than naming a location it can't make private. Candidates are tried in a fixed order (`os.tmpdir()`, then `$HOME/.baz/scratch`) so separate hook processes in one session always resolve the same directory.

Because the path is computed, **the agent can't guess it**: `session-start.js` emits it on every platform ("If you write a plan file for this session, write it to …"), and `plan-with-baz` defers to that injected path. `plan-complete.js` matches the plan write by *basename*, so it keeps triggering wherever the directory resolves to.

The plan is deleted on the normal path (`extractPlan()` unlinks it right after reading) **and** at session end, since the normal path only covers a hook that fires and gets that far.

**The `repos` file is read, never consumed.** `collectRepos()` reads it and leaves it in place, unlike `extractPlan()`. `plan-complete.js` fires more than once for one plan (on Claude Code the plan-file write and then `ExitPlanMode`, and on any platform every revision), and the last fire overwrites the parked payload. When `collectRepos()` unlinked the file, every fire after the first saw only the cwd repo, so a plan that searched five repos uploaded with `repoNames` naming one. Cleanup belongs to `session-end.js` and the reaper, which already cover this file. Two tests fire the hook twice and assert the full set survives, one of them through `plan-attach.js` so a drop on either side of the handoff fails.

**The `tokens` file is read, never consumed either**, for the same reason. `extractCursorUsage()` used to unlink both namespaces, so on a revised plan the second fire reported only the turns since the first, or dropped `tokensUsed` entirely. The tally is cumulative for the session, so re-reading it has to see the whole file. Only Cursor uses this file; Claude Code and Codex read token counts from the host transcript.

The cost of both changes lands on Cursor, which wires no session-end and so never reaps: `repos` and `tokens` now accumulate there the way the counter file would have, which is why `post-tool-use.js` skips the counter on Cursor. Accepted under the "Cursor is best-effort" posture, since each file is a few hundred bytes at mode 0600 inside a 0700 directory, and correct attribution and token counts on a revised plan are worth more than reaping them. Giving Cursor a reaper needs a lifecycle hook it actually runs, which is a separate change.

**Every name in the `repos` file is re-validated on read, against `SAFE_REPO_ARG`.** `post-tool-use.js` appends whatever `repository` / `sessionRepository` the agent passed to a search tool, and the agent's arguments can be shaped by untrusted content it just read. `collectRepos()` interpolates the result into `additionalContext` or the parked payload, both of which the model reads as instruction text, so validating only the cwd-derived name left a laundering path from file content into the prompt.

`SAFE_REPO_ARG` makes the owner half optional, because `baz-codebase-exploration` documents the short leaf name (`baz`) as a valid `repository` argument; requiring the slash dropped those repos from the upload. `SAFE_REPO` stays strict for `repoFromCwd()`, which parses a git remote and always has both halves. **The character class is the security control, not the shape** — it is what keeps a newline, backtick, quote or space out of instruction text. One test asserts both directions, so the filter cannot be tightened or dropped unnoticed.

`session-end.js` does three things: unlinks this session's `plan` / `plan-pending` / `repos` / `tokens` files **when the event is terminal**, consumes the counter file, and reaps any `.baz-*` scratch file older than 24h (in the scratch directory and in `/tmp`, so leftovers from versions before the private directory don't outlive the upgrade). **The reaper skips the running session's own files** — on Codex it fires every turn, so a session that has been planning for more than a day would otherwise reap its own live plan.

**Readers accept the pre-upgrade location; writers never use it.** A session already running when the plugin is upgraded (a live `/reload-plugins`) has its plan, repo list, token tally and parked payload sitting in `/tmp`, written by the previous hooks. `readScratchFile()` checks the private path first and falls back to `/tmp`, unlinking whichever file it actually consumed, so an in-flight plan still reaches `update_plan` instead of the agent sending `{}`. Nothing writes to `/tmp` any more.

**"When terminal" is load-bearing.** Codex has no session-end event and fires `Stop` after every turn, so on Codex this script runs repeatedly inside one live session — deleting the plan there would destroy it before `plan-complete.js` reads it, and deleting `repos` would drop the attribution `post-tool-use.js` is still appending to. Each manifest therefore passes its vendor as `argv[2]`, and the per-session unlink is skipped for `codex`, whose leftovers fall to the reaper instead. Cursor wires no session-end at all, so a Cursor-only machine never runs the reaper; that follows the existing "Cursor is best-effort" posture.

The counter file is **claimed by rename before it is read**. Codex fires `Stop` per turn, so a plain read-then-delete lets two overlapping runs both read the same file and print the summary twice; `rename(2)` is atomic, and the loser gets ENOENT and exits quietly. A run that dies mid-claim leaves a `.<pid>.claim` file, which the reaper also matches.

## Hook counter mechanics

`post-tool-use.js` appends to `.baz-counts-<session_id>.json` in the scratch directory. `session-end.js` claims that file by rename, then reads, prints, and deletes the claim — see "Scratch-file lifecycle" for why the claim is what makes the summary print once. Scripts are shared across all three platforms — only the hook manifests differ (event names, path variables, and the vendor argument each passes).

| Platform | Session-start event | Tool event | Session-end event | Path variable |
|---|---|---|---|---|
| Claude Code | `SessionStart` | `PreToolUse` + `PostToolUse` | `SessionEnd` | `${CLAUDE_PLUGIN_ROOT}` |
| Codex | `SessionStart` | `PostToolUse` | `Stop` | `${PLUGIN_ROOT}` |
| Cursor | `sessionStart` | `postToolUse` | *(none — see below)* | `${CURSOR_PLUGIN_ROOT}` |

**Cursor limitation — no counter/summary.** Cursor's hook validator does not recognize `sessionEnd`, and using its per-turn `stop` for `session-end.js` would wipe the counter mid-session. Rather than leak `.baz-counts-<sessionId>.json` forever with no reaper, `post-tool-use.js` short-circuits on Cursor payloads (detected via `conversation_id` without `session_id`). Cursor users get no tool-usage summary at session end — accepted as consistent with the "Cursor is best-effort" posture (see the Completion-trigger design section: no automated postToolUse nudge on Cursor either).

**Codex limitation.** Codex has no session-end event — its only lifecycle event past `PostToolUse` is `Stop`, which fires per-turn. That means `session-end.js` on Codex prints/clears the counter after every turn, and the summary reflects only the last turn's calls. Fixing this requires either an upstream Codex hook addition or a different consumer-owned cleanup pattern.

## Completion-trigger design

`planner_session_completed` is emitted server-side when the agent calls `mcp__baz__update_plan`. That single tool call also upserts the plan into baz's plans store (`series_key = sessionId`). The agent needs a "planning is over" signal, but the right signal differs per platform:

- **Claude Code**: two PostToolUse matchers both point at `plan-complete.js` — `Write|Edit` (the file-write branch, and the path `plan-with-baz` takes: it writes the plan file inline) and `ExitPlanMode` (CC's native end-of-planning tool, which covers a session where file writes are blocked).
- **Cursor / Codex**: no `ExitPlanMode` tool, so writing the scratch plan file is the only end-of-planning signal available. `plan-complete.js` matches that write across the platform's file-write tools (`apply_patch|Write|Edit` on Codex, `edit_file|write_file|Write|Edit` on Cursor) and injects the consent prompt. **`session-start.js` is what tells the agent to write that file** — it emits the completion contract for both `codex` and `cursor`. `plan-with-baz` says the same thing, but it's `disable-model-invocation: true`, so a user who plans without running the command would never write the file; the SessionStart branch is the only thing covering ad-hoc planning on those two platforms. Don't move this contract back into `baz-codebase-exploration` to solve that — it's platform plumbing, and that skill owns search routing only.

Both paths converge on `mcp__baz__update_plan`. BFF upserts the plan and flips the reviewer_executions row to `status='success'` with `completed_at` set.

### Who supplies the plan text

On Claude Code the agent never re-types the plan: `plan-complete.js` parks the arguments in `.baz-plan-pending-<sessionId>.json` in the scratch directory (mode 0600), the agent calls `mcp__baz__update_plan` with no arguments, and `plan-attach.js` (PreToolUse) fills them in via `updatedInput` before the call is sent. Generating the plan a second time would cost output tokens and then cache writes when it re-enters context.

Codex and Cursor have no `updatedInput`, so they keep receiving the plan inline in the hook instruction and pass it themselves. `plan-attach.js` only ever adds what is missing, so their calls pass through untouched. The parked file is Claude-only and is deleted by `session-end.js`.

The call shape is stated in three places that must agree, since each is the only one some path sees: the hook instruction in `plan-complete.js`, Step 4 of `skills/plan-with-baz/SKILL.md`, and the `update_plan` tool description in the `baz` repo. A skill that still says "pass `content`" silently undoes this — the upload keeps working, only the saving disappears. The one deliberate exception is `get-plan-comments` Step B, which passes `sessionId` and `content` itself because it may be updating a plan the current session did not create; the hook would fill in this session's id and publish to the wrong plan.

### Upload requires user consent

**`update_plan` is never called automatically.** Uploading publishes the plan into Baz, where the org can read and comment on it, so the user decides. `plan-complete.js` supplies the authoritative arguments and instructs the agent to *ask*; it does not authorize the call. On a "no" the agent skips the call, the plan is never published and the planner session stays open — accepted, and cheaper than publishing something the user didn't want shared.

The follow-up that points at the comments command is **named per vendor** (`commentsCommand` in `plan-complete.js`), because the three hosts invoke it three different ways and `README.md` is the source of truth for that table. One shared `/baz:` string handed Codex and Cursor users a command their host does not have. A test asserts each vendor's wording.

The upload question is the **only** thing the plugin asks the agent to raise once the plan exists. What the user does with the plan next — implement it, revise it, drop it — is ordinary conversation between them and the agent; don't widen the hook into a menu of next actions, which puts the plugin in the middle of decisions that aren't its business.

The consent gate is stated in four places that must stay in sync, because each is the only one some path sees: the hook instruction in `plan-complete.js` (the main path), the `codex`/`cursor` completion contract in `session-start.js` (Cursor gets no PostToolUse prompt, so it must self-raise the question), Step 4 of `skills/plan-with-baz/SKILL.md` (the `/baz:plan-with-baz` path), and the `update_plan` tool description in the `baz` repo (`mcp/src/index.ts`) — the last is the only copy that survives when the plugin isn't installed at all. It is deliberately **not** in `baz-codebase-exploration`.

Consent is asked **once** per session. The hook fires on every plan-file write, so a revision re-triggers it, and on Claude Code it can fire twice for one plan (the `~/.claude/plans/*.md` write, then `ExitPlanMode`); the instruction tells the agent to honor an upload answer it already has rather than re-ask, and identical resubmits are deduped server-side by content hash anyway.

### Plan link

`update_plan` returns a shareable `https://<BACKEND_BASE_URL>/plans/<seriesId>` URL (`mcp/src/tools/update-plan.ts`), built the same way as the plan links in bff's notification handlers. `/plans/:seriesId` is the addressable route, so the link uses the **series** id, not the version id. The tool result tells the agent to surface the link, and the skills repeat it — without that, a successful upload reads as a dead end to the user.

### Reading a plan back

`get_plan` is the read side of that link: given the URL (or a bare series id) it returns the plan body, its status, its linked PRs and its version list. It is the only plan tool `plan-attach.js` does not fill in for, because the whole point is a plan somebody else wrote and pasted. That is why it stays out of the PreToolUse matcher — filling in this session's id would silently read the wrong plan. Versions are positional and 1-indexed from the oldest, matching the plan page's `?version=`; a `?version=` in the pasted URL is honoured, and an explicit `version` argument beats it.

### Linking the PR back

`link_plan_to_pr` closes the loop after implementation: it records that a PR implements the plan and flips the plan to `implemented`. The link is stored against the **series**, so every later plan version keeps it and the agent calls the tool once per PR rather than once per version. The PR is addressed by repository + number, not by a Baz PR id, so the call works immediately after the PR is opened — before the webhook that ingests it has landed, on any provider. Its consent posture is unlike `update_plan`'s: the plan is already published by the time there is a PR to link, so linking adds no new exposure and needs no separate ask.


## Adding a new hook

1. Edit the shared JS files in `hooks/` if logic changes. A new hook script starts with `failSoft()` + `readHookInput()` from `./hook-io` and bails on a `null` payload — see "Hooks must never exit non-zero".
2. **Shared events** (e.g. `SessionStart`, `PostToolUse` counter, session-end summary):
   update all three `hooks.*.json` files. Note that Cursor uses camelCase event
   names + a flatter manifest shape (no nested `hooks` array, command directly on the entry).
3. The `PostToolUse` block in `hooks.json` has three matchers today:
   - `mcp__baz__` → `post-tool-use.js` (counts baz MCP tool calls)
   - `Write|Edit` → `plan-complete.js` (file-write branch: fires when the agent writes the scratch plan file)
   - `ExitPlanMode` → `plan-complete.js` (fires when the agent exits CC's plan mode)
   Add new matchers as additional entries in the same `PostToolUse` array.

## MCP server

All three platforms wire `https://baz.co/mcp` as an HTTP MCP server named `baz`. OAuth (Descope) opens on first use.
