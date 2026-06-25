---
name: plan-with-baz
description: >
  Plan a feature or change end-to-end using Baz indexed search across your
  org's repos. Enters plan mode, explores the relevant repos with Baz's MCP
  tools, and produces a structured implementation plan. Invoke with
  /baz:plan-with-baz when you want to start planning a piece of work.
disable-model-invocation: true
argument-hint: [feature or change to plan]
license: MIT
---

# Plan with Baz

You were invoked explicitly to plan a piece of work using Baz's indexed search. The work to plan is in `$ARGUMENTS` (if empty, ask the user what they want to plan).

This is a **read-only** procedure. Do not edit files, run mutating commands, or start implementing until the user approves the plan.

## Step 1: Enter plan mode

Get into plan mode before exploring, where the harness supports it:

- **Claude Code**: if you are not already in plan mode, call the `EnterPlanMode` tool now (the user confirms with one click), then continue.
- **Cursor**: tell the user to switch to **Plan** mode (Cmd/Ctrl+Shift+P toggle), then continue.
- **Codex** (or any harness without plan mode): there is no mode to enter — just follow this procedure read-only and do not write any files until the plan is approved.

## Step 2: Explore with Baz

Follow the tool-routing rules in the **`baz-codebase-exploration`** skill. The essentials:

| Job | Tool |
|---|---|
| Find which repos are involved | `repo_search` (Baz) |
| Find code by symbol / regex inside a repo | `remote_grep` (Baz) |
| Find files by name / glob inside a repo | `remote_file_search` (Baz) |
| Read a specific file you already know the path of | `gh api repos/<owner>/<repo>/contents/<path>` |

Baz MCP tools replace `gh` / `glab` for *search*; use `gh` / `glab` only to read a known path. **Search budget:** call `repo_search` once, don't rephrase keywords, and after 3 searches on the same `(repository, path)` pair read a matched file before searching that pair again. A good run uses fewer than 10 searches total. See `baz-codebase-exploration` for the full rules and forbidden patterns.

## Step 3: Write the plan

Produce the plan in the fixed schema below — always these sections, in this order. On Claude Code, write it to the plan file plan mode gives you; on other harnesses, write it to `baz-plan.md` in the working directory.

```markdown
# Plan: <title>

## Context
Why this change is being made — the problem, what prompted it, the intended outcome.

## Affected repos & files
- `<repo> · <path>` — what changes here and why
  (works for repos not checked out locally — that's the point of Baz)

## Change sequence
1. Ordered steps to implement.

## Cross-repo coordination
Anything that must land together across repos. Omit if single-repo.

## Open questions
Things the user should decide before implementation begins.

## Verification
How to test the change end-to-end (run the code, MCP tools, tests).
```

Keep these section headings stable and exact — they are the contract a future "share / push to Baz" step will parse.

## Step 4: Get approval

Present the plan and ask the user to approve before any implementation begins (on Claude Code, exit plan mode to request approval). Do not start editing until they say go.
