# Baz Plugin

The Baz plugin adds three indexed search tools to your agent — `repo_search`, `remote_grep`, and `remote_file_search` — and a skill that routes searches through Baz while keeping reads on `gh` / `glab`.

Designed for planning features against repositories you haven't checked out locally. Indexed search across the whole org, no clone, no rate limits.

## Install

### Claude Code

```bash
/plugin install baz-scm/baz-plugin@main
```

Claude Code reads `.claude-plugin/plugin.json`, loads `skills/baz-codebase-exploration/SKILL.md`, and registers the Baz MCP server. First time you use a Baz tool, your browser opens for OAuth (Descope) — log in with your Baz account.

### OpenAI Codex CLI

```bash
codex plugin install baz-scm/baz-plugin@main
```

Codex reads `.codex-plugin/plugin.json` and wires the same skill + MCP server. OAuth flow is identical to Claude Code's.

### Cursor

Cursor doesn't auto-install MCP servers. Two manual steps:

1. **Add the rule.** Copy `.cursor/rules/baz-codebase-exploration.mdc` into your project's `.cursor/rules/` directory, or globally to `~/.cursor/rules/`.
2. **Wire the MCP server.** Open *Cursor Settings → MCP* and add:
   ```json
   {
     "mcpServers": {
       "baz": {
         "type": "http",
         "url": "https://mcp.baz.co/mcp"
       }
     }
   }
   ```
   Cursor will open the OAuth flow on first use.

## What you get

- **`repo_search(keywords, domains?)`** — semantic search across indexed architecture summaries. Works across every repo in your org, and across the per-domain summaries of a single large monorepo. No `gh` equivalent.
- **`remote_grep(repository, pattern, path)`** — indexed regex grep inside one repo, scoped to a path. ~2 lines of context per match.
- **`remote_file_search(repository, pattern)`** — glob file-name search inside one repo. Useful when you have a naming hunch but not the exact path.

The skill teaches the agent when to use which, and to stop searching and start reading once it has a hit.

## License

MIT
