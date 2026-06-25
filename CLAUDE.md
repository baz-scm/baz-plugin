# baz-plugin

Plugin for Claude Code, Codex CLI, and Cursor that adds Baz indexed search tools and a session-level tool-usage summary hook.

## Repo layout

```
.claude-plugin/plugin.json      CC plugin manifest (MCP server + skills + hooks)
.codex-plugin/plugin.json       Codex CLI plugin manifest
.cursor-plugin/plugin.json      Cursor plugin manifest

hooks/
  post-tool-use.js              Shared: increments per-tool counter in /tmp on each Baz MCP call
  session-end.js                Shared: prints call summary to console at session end, cleans up /tmp

  hooks.json                    CC hooks: PostToolUse + SessionEnd, ${CLAUDE_PLUGIN_ROOT}
  hooks.codex.json              Codex hooks: PostToolUse + Stop, ${CODEX_PLUGIN_DIR}
  hooks.cursor.json             Cursor hooks: postToolUse + stop, ${CURSOR_PLUGIN_ROOT}

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

`plan-with-baz` emits a fixed set of sections, in order: **Context · Affected repos & files · Change sequence · Cross-repo coordination · Open questions · Verification**. Keep these headings stable — a future "share / push to Baz" step (rendering plans in the Baz product) will parse them.

## Hook counter mechanics

`post-tool-use.js` writes to `/tmp/.baz-counts-<session_id>.json`. `session-end.js` reads, prints, and deletes it. Scripts are shared across all three platforms — only the hook manifests differ (event names, path variables).

| Platform | Tool event | Session-end event | Path variable |
|---|---|---|---|
| Claude Code | `PostToolUse` | `SessionEnd` | `${CLAUDE_PLUGIN_ROOT}` |
| Codex | `PostToolUse` | `Stop` | `${CODEX_PLUGIN_DIR}` |
| Cursor | `postToolUse` | `stop` | `${CURSOR_PLUGIN_ROOT}` |

## Adding a new hook

1. Edit the shared JS files in `hooks/` if logic changes.
2. Update all three `hooks.*.json` files if the event or structure changes.
3. Hook matcher `mcp__baz__` catches all three Baz MCP tools (`cross_repo_search`, `remote_grep`, `remote_file_search`).

## MCP server

All three platforms wire `https://baz.co/mcp` as an HTTP MCP server named `baz`. OAuth (Descope) opens on first use.
