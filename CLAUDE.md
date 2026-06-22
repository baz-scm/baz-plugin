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

skills/baz-codebase-exploration/SKILL.md   Skill injected into context on install
.cursor/rules/baz-codebase-exploration.mdc Same skill, Cursor rules format
```

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
