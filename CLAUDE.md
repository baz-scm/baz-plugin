# baz-plugin

Plugin for Claude Code, Codex CLI, and Cursor that adds Baz indexed search tools. All three platforms wire a session-start hook that surfaces session id + cwd repo so baz can correlate tool calls, and a PostToolUse hook that watches for the agent writing its final plan to `/tmp/.baz-plan-<sessionId>.md` — that file-write is the cross-platform "I'm done planning" signal that nudges the agent to call `mcp__baz__complete_session` and emit the `mcp_session_completed` timeline event.

## Repo layout

```
.claude-plugin/plugin.json      CC plugin manifest (MCP server + skills + hooks)
.codex-plugin/plugin.json       Codex CLI plugin manifest
.cursor-plugin/plugin.json      Cursor plugin manifest

hooks/
  session-start.js              Shared: emits additionalContext telling the assistant the session id + cwd repo (allowlist-validated), so it passes them through to baz MCP tools for session correlation. Handles `cwd` (CC/Codex) and `workspace_roots[0]` (Cursor).
  plan-complete.js              Shared completion trigger: prompts the agent to call mcp__baz__complete_session. Branches on tool_name — ExitPlanMode (CC plan mode) always fires; file-write tools (Write/Edit/apply_patch/edit_file/write_file) fire only when the path matches /tmp/.baz-plan-<sessionId>.md. CC wires both branches; Cursor/Codex have no ExitPlanMode and rely on the file-write branch.
  post-tool-use.js              Shared: increments per-tool counter in /tmp on each Baz MCP call
  session-end.js                Shared: prints call summary to console at session end, cleans up /tmp

  hooks.json                    CC hooks: SessionStart + PostToolUse (mcp__baz__ + Write|Edit) + SessionEnd, ${CLAUDE_PLUGIN_ROOT}
  hooks.codex.json              Codex hooks: SessionStart + PostToolUse (mcp__baz__ + apply_patch|Write|Edit) + Stop, ${CODEX_PLUGIN_DIR}
  hooks.cursor.json             Cursor hooks: sessionStart + postToolUse (mcp__baz__ + edit_file|write_file|Write|Edit) + stop, ${CURSOR_PLUGIN_ROOT}

skills/baz-codebase-exploration/SKILL.md   Reference skill: auto-loaded tool-routing rules
skills/plan-with-baz/SKILL.md              Task skill: manual /baz:plan-with-baz planning command
.cursor/rules/baz-codebase-exploration.mdc Reference skill, Cursor rules format (always-apply)
```

## Skills

Two skills, by type:

- **`baz-codebase-exploration`** — *reference* content. Auto-loaded; the tool-routing rules + search budget. Also mirrored as a Cursor always-apply rule (`.cursor/rules/*.mdc`).
- **`plan-with-baz`** — *task* content. Manually invoked as `/baz:plan-with-baz` (`disable-model-invocation: true` so Claude won't auto-trigger it). Enters plan mode per-harness, explores via Baz, and emits a plan in a fixed section schema. It defers the detailed routing rules to `baz-codebase-exploration` rather than forking the table.

Both live under `skills/` and ship to all three platforms with no manifest change — Codex and Cursor manifests already point at `./skills/`, Claude Code auto-discovers. The `plan-with-baz` skill is on-demand, so it has **no** `.cursor/rules/*.mdc` mirror (rules are always-apply).

### Plan output schema (Tier-3 contract)

`plan-with-baz` emits a plan in a fixed, ordered section schema — the canonical definition is the Step 3 template in `skills/plan-with-baz/SKILL.md`. Every heading is always emitted in order (empty sections render as `_None._`), and diagrams are inline ```mermaid``` blocks. Keep that template stable — a future "share / push to Baz" step (rendering plans in the Baz product) will parse these headings. Edit the schema in the skill, not here.

## Hook counter mechanics

`post-tool-use.js` writes to `/tmp/.baz-counts-<session_id>.json`. `session-end.js` reads, prints, and deletes it. Scripts are shared across all three platforms — only the hook manifests differ (event names, path variables).

| Platform | Session-start event | Tool event | Session-end event | Path variable |
|---|---|---|---|---|
| Claude Code | `SessionStart` | `PostToolUse` | `SessionEnd` | `${CLAUDE_PLUGIN_ROOT}` |
| Codex | `SessionStart` | `PostToolUse` | `Stop` | `${CODEX_PLUGIN_DIR}` |
| Cursor | `sessionStart` | `postToolUse` | `stop` | `${CURSOR_PLUGIN_ROOT}` |

## Completion-trigger design

`mcp_session_completed` is emitted by the agent itself via `mcp__baz__complete_session`. The agent needs a "planning is over" signal, but the right signal differs per platform:

- **Claude Code**: two PostToolUse matchers both point at `plan-complete.js` — `ExitPlanMode` (CC's native end-of-planning tool, used when the agent is in plan mode which blocks file writes) and `Write|Edit` (the file-write branch, fires when the agent plans without entering plan mode and writes the plan file inline).
- **Cursor / Codex**: no `ExitPlanMode` tool. SKILL.md / `.cursor/rules/...mdc` / `AGENTS.md` instruct the agent to write its final plan to `/tmp/.baz-plan-<sessionId>.md` at end of planning; `plan-complete.js` matches that write across the platform's file-write tools (`apply_patch|Write|Edit` on Codex, `edit_file|write_file|Write|Edit` on Cursor) and injects the nudge.

Both paths converge on `mcp__baz__complete_session`. BFF flips the row to `status='success'` with `completed_at` set.


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
