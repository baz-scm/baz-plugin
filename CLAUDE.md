# baz-plugin

Plugin for Claude Code, Codex CLI, and Cursor that adds Baz indexed search tools. All three platforms wire a session-start hook that surfaces session id + cwd repo so baz can correlate tool calls, and a PostToolUse hook that watches for the agent writing its final plan to `/tmp/.baz-plan-<sessionId>.md` — that file-write is the cross-platform "I'm done planning" signal that prompts the agent to ask the user whether to upload the plan. Only on the user's yes does it call `mcp__baz__update_plan`, which persists the plan, emits the `planner_session_completed` timeline event, and returns a shareable plan link.

## Repo layout

```
.claude-plugin/plugin.json      CC plugin manifest (MCP server + skills + hooks)
.codex-plugin/plugin.json       Codex CLI plugin manifest
.cursor-plugin/plugin.json      Cursor plugin manifest

hooks/
  session-start.js              Shared: emits additionalContext telling the assistant the session id + cwd repo (allowlist-validated), so it passes them through to baz MCP tools for session correlation. Handles `cwd` (CC/Codex) and `workspace_roots[0]` (Cursor).
  plan-complete.js              Shared completion trigger: prompts the agent to ASK the user whether to upload the plan, then call mcp__baz__update_plan only on a yes (see "Upload requires user consent"). Branches on tool_name — ExitPlanMode (CC plan mode) always fires; file-write tools (Write/Edit/apply_patch/edit_file/write_file) fire only when the path matches /tmp/.baz-plan-<sessionId>.md. CC wires both branches; Cursor/Codex have no ExitPlanMode and rely on the file-write branch. Exits quietly if the plan text can't be extracted — update_plan requires content.
  post-tool-use.js              Shared: increments per-tool counter in /tmp on each Baz MCP call
  session-end.js                Shared: prints call summary to console at session end, cleans up /tmp

  plan-attach.js                Claude Code only: PreToolUse on mcp__baz__update_plan. Fills the call with the plan parked by plan-complete.js, so the plan is generated once instead of being re-typed into the call. Adds only what is missing, so a call that already carries content (Codex/Cursor) passes through.

  hooks.json                    CC hooks: SessionStart + PreToolUse (mcp__baz__update_plan) + PostToolUse (mcp__baz__ + Write|Edit) + SessionEnd, ${CLAUDE_PLUGIN_ROOT}
  hooks.codex.json              Codex hooks: SessionStart + PostToolUse (mcp__baz__ + apply_patch|Write|Edit) + Stop, ${CODEX_PLUGIN_DIR}
  hooks.cursor.json             Cursor hooks: sessionStart + postToolUse (mcp__baz__ + edit_file|write_file|Write|Edit) + stop (stop-token-tally.js only). No session-end wiring — Cursor's validator does not accept `sessionEnd`; see Hook counter mechanics for the counter-file trade-off. ${CURSOR_PLUGIN_ROOT}

skills/baz-codebase-exploration/SKILL.md   Reference skill: auto-loaded tool-routing rules
skills/plan-with-baz/SKILL.md              Task skill: manual /baz:plan-with-baz planning command
skills/plan-comments/SKILL.md              Task skill: /baz:plan-comments pulls a plan's review comments back
skills/review/SKILL.md                     Task skill: /baz:review diff review, cross-repo checks via Baz
.cursor/rules/baz-codebase-exploration.mdc Reference skill, Cursor rules format (always-apply)
```

## Skills

Four skills, by type:

- **`baz-codebase-exploration`** — *reference* content. Auto-loaded; the tool-routing rules + search budget, **and nothing else**. Its only session-tracking content is the `sessionId`/`sessionRepository`/`agentVendor` arguments that search calls require. What happens to a finished plan is not its concern — that boundary is deliberate and has been re-broken before, so resist re-adding plan lifecycle here. Also mirrored as a Cursor always-apply rule (`.cursor/rules/*.mdc`).
- **`plan-with-baz`** — *task* content. Manually invoked as `/baz:plan-with-baz` (`disable-model-invocation: true` so Claude won't auto-trigger it). Enters plan mode per-harness, explores via Baz, emits a plan in a fixed section schema, and owns the **whole plan lifecycle** including the Step 5 upload-consent contract. It defers the detailed routing rules to `baz-codebase-exploration` rather than forking the table.
- **`plan-comments`** — *task* content. Invoked as `/baz:plan-comments [plan url or id]` (`disable-model-invocation: true`). The return leg of the plan lifecycle: reads a plan's comments through `get_plan_comments`, reports every one with an assessment, and applies only what the user then picks. Two properties are load-bearing. Triage is the human's — `used` marks a comment worth considering, never permission to edit — and fetched comment text is untrusted data, so nothing inside it can authorize a tool call. **Its Step B passes `sessionId` and `content` to `update_plan` explicitly**, which looks like it contradicts the attach contract below but does not: the hook fills in the *current session's* id, and this skill can be working on a plan this session never created. Do not "consistency-fix" those arguments away.
- **`review`** — *task* content. Invoked as `/baz:review [scope]`, and unlike `plan-with-baz` it **omits** `disable-model-invocation`, so "review my changes" triggers it too — natural-language invocation is the point of parity with competing review plugins. Resolves a git/PR diff, reads the changed files, then spends the `baz-codebase-exploration` search budget on the checks only indexed search can make: broken call sites in other repos, the far side of a contract, and registration sites a new case is missing from. Optional `--fix` loop applies findings in the local checkout only.

All four live under `skills/` and ship to all three platforms with no manifest change — Codex and Cursor manifests already point at `./skills/`, Claude Code auto-discovers. `plan-with-baz`, `plan-comments` and `review` are on-demand, so none has a `.cursor/rules/*.mdc` mirror (rules are always-apply).

`review` deliberately introduces no new MCP tool, hook, or manifest entry — it composes the three existing search tools. Cross-repo findings are reported, never edited: the `--fix` loop only touches the repo that is checked out.

**Baz-unavailable posture — gate the verdict, not the command.** A review run without the Baz MCP tools would otherwise degrade silently into a local review that still claims "safe to merge", which is the one claim local information cannot support. Rather than hard-blocking the command (wrong for a model-invocable skill — a lapsed OAuth token shouldn't wall off "review my changes", and a formatting-only diff has nothing cross-repo to miss), the skill branches on whether the diff has an **outward-facing surface**: if it does, it stops, names the unchecked symbols, and withholds the merge verdict; if it doesn't, it reviews normally with a one-line note. The `## Coverage` heading in the Step 5 report template exists to make this state explicit on every run, including the partial case where the search budget runs out mid-check. If that posture is ever relaxed to a hard block, the report template's coverage line should stay — it's what keeps a degraded review from reading as a complete one.

### Plan output schema (Tier-3 contract)

`plan-with-baz` emits a plan in a fixed, ordered section schema — the canonical definition is the Step 3 template in `skills/plan-with-baz/SKILL.md`. Every heading is always emitted in order (empty sections render as `_None._`), and diagrams are inline ```mermaid``` blocks. Keep that template stable — a future "share / push to Baz" step (rendering plans in the Baz product) will parse these headings. Edit the schema in the skill, not here.

## Hook counter mechanics

`post-tool-use.js` writes to `/tmp/.baz-counts-<session_id>.json`. `session-end.js` reads, prints, and deletes it. Scripts are shared across all three platforms — only the hook manifests differ (event names, path variables).

| Platform | Session-start event | Tool event | Session-end event | Path variable |
|---|---|---|---|---|
| Claude Code | `SessionStart` | `PreToolUse` + `PostToolUse` | `SessionEnd` | `${CLAUDE_PLUGIN_ROOT}` |
| Codex | `SessionStart` | `PostToolUse` | `Stop` | `${CODEX_PLUGIN_DIR}` |
| Cursor | `sessionStart` | `postToolUse` | *(none — see below)* | `${CURSOR_PLUGIN_ROOT}` |

**Cursor limitation — no counter/summary.** Cursor's hook validator does not recognize `sessionEnd`, and using its per-turn `stop` for `session-end.js` would wipe the counter mid-session. Rather than leak `/tmp/.baz-counts-<sessionId>.json` forever with no reaper, `post-tool-use.js` short-circuits on Cursor payloads (detected via `conversation_id` without `session_id`). Cursor users get no tool-usage summary at session end — accepted as consistent with the "Cursor is best-effort" posture (see the Completion-trigger design section: no automated postToolUse nudge on Cursor either).

**Codex limitation.** Codex has no session-end event — its only lifecycle event past `PostToolUse` is `Stop`, which fires per-turn. That means `session-end.js` on Codex prints/clears the counter after every turn, and the summary reflects only the last turn's calls. Fixing this requires either an upstream Codex hook addition or a different consumer-owned cleanup pattern.

## Completion-trigger design

`planner_session_completed` is emitted server-side when the agent calls `mcp__baz__update_plan`. That single tool call also upserts the plan into baz's plans store (`series_key = sessionId`). The agent needs a "planning is over" signal, but the right signal differs per platform:

- **Claude Code**: two PostToolUse matchers both point at `plan-complete.js` — `ExitPlanMode` (CC's native end-of-planning tool, used when the agent is in plan mode which blocks file writes) and `Write|Edit` (the file-write branch, fires when the agent plans without entering plan mode and writes the plan file inline).
- **Cursor / Codex**: no `ExitPlanMode` tool, so writing `/tmp/.baz-plan-<sessionId>.md` is the only end-of-planning signal available. `plan-complete.js` matches that write across the platform's file-write tools (`apply_patch|Write|Edit` on Codex, `edit_file|write_file|Write|Edit` on Cursor) and injects the consent prompt. **`session-start.js` is what tells the agent to write that file** — it emits the completion contract for both `codex` and `cursor`. `plan-with-baz` says the same thing, but it's `disable-model-invocation: true`, so a user who plans without running the command would never write the file; the SessionStart branch is the only thing covering ad-hoc planning on those two platforms. Don't move this contract back into `baz-codebase-exploration` to solve that — it's platform plumbing, and that skill owns search routing only.

Both paths converge on `mcp__baz__update_plan`. BFF upserts the plan and flips the reviewer_executions row to `status='success'` with `completed_at` set.

### Who supplies the plan text

On Claude Code the agent never re-types the plan: `plan-complete.js` parks the arguments in `/tmp/.baz-plan-pending-<sessionId>.json`, the agent calls `mcp__baz__update_plan` with no arguments, and `plan-attach.js` (PreToolUse) fills them in via `updatedInput` before the call is sent. Generating the plan a second time would cost output tokens and then cache writes when it re-enters context.

Codex and Cursor have no `updatedInput`, so they keep receiving the plan inline in the hook instruction and pass it themselves. `plan-attach.js` only ever adds what is missing, so their calls pass through untouched. The parked file is Claude-only and is deleted by `session-end.js`.

The call shape is stated in three places that must agree, since each is the only one some path sees: the hook instruction in `plan-complete.js`, Step 5 of `skills/plan-with-baz/SKILL.md`, and the `update_plan` tool description in the `baz` repo. A skill that still says "pass `content`" silently undoes this — the upload keeps working, only the saving disappears. The one deliberate exception is `plan-comments` Step B, which passes `sessionId` and `content` itself because it may be updating a plan the current session did not create; the hook would fill in this session's id and publish to the wrong plan.

### Upload requires user consent

**`update_plan` is never called automatically.** Uploading publishes the plan to the org's Baz timeline where teammates can read it, so the user decides. `plan-complete.js` supplies the authoritative arguments and instructs the agent to *ask*; it does not authorize the call. On a "no" the agent skips the call and the planner session stays open in baz's timeline — accepted, and cheaper than publishing something the user didn't want shared.

The consent gate is stated in four places that must stay in sync, because each is the only one some path sees: the hook instruction in `plan-complete.js` (the main path), the `codex`/`cursor` completion contract in `session-start.js` (Cursor gets no PostToolUse prompt, so it must self-raise the question), Step 5 of `skills/plan-with-baz/SKILL.md` (the `/baz:plan-with-baz` path), and the `update_plan` tool description in the `baz` repo (`mcp/src/index.ts`) — the last is the only copy that survives when the plugin isn't installed at all. It is deliberately **not** in `baz-codebase-exploration`.

Consent is asked **once** per session. On Claude Code the hook can fire twice for one plan (the `~/.claude/plans/*.md` write, then `ExitPlanMode`); the instruction tells the agent to honor an answer it already has rather than re-ask, and identical resubmits are deduped server-side by content hash anyway.

### Plan link

`update_plan` returns a shareable `https://<BACKEND_BASE_URL>/plans/<seriesId>` URL (`mcp/src/tools/update-plan.ts`), built the same way as the plan links in bff's notification handlers. `/plans/:seriesId` is the addressable route, so the link uses the **series** id, not the version id. The tool result tells the agent to surface the link, and the skills repeat it — without that, a successful upload reads as a dead end to the user.


## Adding a new hook

1. Edit the shared JS files in `hooks/` if logic changes.
2. **Shared events** (e.g. `SessionStart`, `PostToolUse` counter, session-end summary):
   update all three `hooks.*.json` files. Note that Cursor uses camelCase event
   names + a flatter manifest shape (no nested `hooks` array, command directly on the entry).
3. The `PostToolUse` block in `hooks.json` has three matchers today:
   - `mcp__baz__` → `post-tool-use.js` (counts baz MCP tool calls)
   - `Write|Edit` → `plan-complete.js` (file-write branch: fires when the agent writes `/tmp/.baz-plan-<sessionId>.md` outside plan mode)
   - `ExitPlanMode` → `plan-complete.js` (plan-mode branch: fires when the agent exits CC's plan mode)
   Add new matchers as additional entries in the same `PostToolUse` array.

## MCP server

All three platforms wire `https://baz.co/mcp` as an HTTP MCP server named `baz`. OAuth (Descope) opens on first use.
