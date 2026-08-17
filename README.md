# Baz Plugin

The Baz plugin adds three indexed search tools to your agent — `repo_search`, `remote_grep`, and `remote_file_search` — and a skill that routes searches through Baz while keeping reads on `gh` / `glab`.

Designed for planning features against repositories you haven't checked out locally. Indexed search across the whole org, no clone, no rate limits.

## Install

### Claude Code

```bash
/plugin marketplace add baz-scm/baz-plugin
/plugin add baz
/reload-plugins
```

Claude Code reads `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, loads `skills/baz-codebase-exploration/SKILL.md`, and registers the Baz MCP server and hook. First time you use a Baz tool, your browser opens for OAuth (Descope) — log in with your Baz account.

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
         "url": "https://baz.co/mcp"
       }
     }
   }
   ```
   Cursor will open the OAuth flow on first use.

## What you get

- **`repo_search(keywords, domains?)`** — semantic search across indexed architecture summaries. Works across every repo in your org, and across the per-domain summaries of a single large monorepo. No `gh` equivalent.
- **`remote_grep(repository, pattern, path)`** — indexed regex grep inside one repo, scoped to a path. ~2 lines of context per match.
- **`remote_file_search(repository, pattern)`** — glob file-name search inside one repo. Useful when you have a naming hunch but not the exact path.

The `baz-codebase-exploration` skill teaches the agent when to use which, and to stop searching and start reading once it has a hit. It loads automatically when relevant.

On top of those, the plugin ships three commands: `/baz:plan-with-baz` for planning a change, `/baz:plan-comments` for pulling a plan's review comments back into your session, and `/baz:review` for reviewing a change.

## Planning command

The plugin also ships a manually-invoked planning command, **`/baz:plan-with-baz`**. Run it with a short description of what you want to build:

```text
/baz:plan-with-baz add rate limiting to the public API
```

It explores the relevant repos with the Baz tools — including repos you haven't checked out — and writes a structured implementation plan you sign off on before any code is written. The agent stays read-only until you approve, so nothing in your working tree changes while it plans.

| Platform | How to invoke |
|---|---|
| Claude Code | `/baz:plan-with-baz <description>` |
| Cursor | `/plan-with-baz <description>` |
| Codex | invoke the `plan-with-baz` skill |

### What happens once the plan is written

The agent shows you the plan and asks which of three things to do next:

- **Implement** — start executing the plan right away.
- **Upload to Baz** — publish it, get a link, collaborate on it (then it asks again what to do next).
- **Change something** — type what you want different; the agent revises the plan and re-asks.

Nothing happens until you pick. **The plan is never uploaded unless you choose "Upload to Baz"** — pick it and you get a link on your organization's Baz timeline, where teammates can open, comment on, and review it.

## Plan comments command

**`/baz:plan-comments`** brings the review comments on a plan back into your session, so feedback doesn't stay stranded in the browser.

```text
/baz:plan-comments                                   # this session's plan
/baz:plan-comments https://baz.co/plans/<plan-id>    # any other plan
```

| Platform | How to invoke |
|---|---|
| Claude Code | `/baz:plan-comments [plan url or id]` |
| Cursor | `/plan-comments [plan url or id]` |
| Codex | invoke the `plan-comments` skill |

It reads every comment and prints one table — what each asks, whether the claim actually holds (checked against the code, with file and line), and what it would change in the plan. Comments are grouped by the Use / Skip decision reviewers made on the plan page: those marked **Use** come with a recommendation to apply, untriaged ones are reported for you to decide, and skipped ones are listed and left alone.

**Nothing is written until you choose.** The agent doesn't edit the plan, post replies, or set anyone's Use/Skip decision off its own reading — marking a comment **Use** tells the agent to consider it, not to start editing. Pick the ones you want and it applies them, replies on each so the commenter is notified with what changed, and pushes a new plan version.

## Review command

**`/baz:review`** reviews your changes the way a reviewer with the whole org's code in front of them would. It resolves a diff, reads the changed files for context, then uses the Baz tools to check the change against repos you don't have checked out — the caller in another service that still passes the old signature, the consumer that reads a field you just renamed, the registration site your new enum value is missing from.

```text
/baz:review                        # everything not yet on the base branch
/baz:review committed              # only commits on this branch
/baz:review uncommitted            # only staged + unstaged edits
/baz:review --include-untracked    # also review new, untracked files
/baz:review --base develop         # compare against a different base
/baz:review --pr 42                # review an open PR (needs gh / glab)
/baz:review --fix                  # review, then apply the fixes it finds
```

Findings come back grouped by severity, each with a `file:line`, the conditions that make it fail, and a fix. Cross-repo findings name the repo they're in. Style nits and pre-existing issues the diff didn't touch are deliberately left out.

You can also just ask — "review my changes", "check this branch for security issues" — and the skill triggers on its own.

**The cross-repo checks require Baz to be connected.** If it isn't, the review won't silently shrink to a local one: for any change with an outward-facing surface (a changed signature, schema, event, or public export) it stops, names the symbols whose consumers it couldn't check, and withholds the merge verdict rather than implying coverage it doesn't have. Purely local changes — formatting, a private helper, a test-only edit — still review normally, since there's nothing cross-repo to miss.

With `--fix` (or when you ask afterwards), it turns the findings into a task list, shows it, then works through it one finding at a time, running the project's tests and linter if there are any. It only edits the repo you have checked out; findings in other repos are reported, not edited.

| Platform | How to invoke |
|---|---|
| Claude Code | `/baz:review [scope]` |
| Cursor | `/review [scope]` |
| Codex | invoke the `review` skill |

## License

MIT
