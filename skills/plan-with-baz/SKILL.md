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

This is a **read-only** procedure. Do not edit project files, run mutating commands, or start implementing until the user approves the plan. The only write allowed before approval is the plan document itself (see Step 3).

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

Produce the plan in the fixed schema below — **always emit every section heading, in this order**, even when a section is empty (write `_None._` rather than dropping the heading). The stable shape is the contract a future "share / push to Baz" step will parse.

Where to put it:
- **Claude Code**: write it to the plan file plan mode gives you (writing that file is what plan mode is for).
- **Cursor / Codex** (no plan mode): write the plan to `/tmp/.baz-plan-<sessionId>.md` using your file-write tool (`Write`, `write_file`, `edit_file`, or `apply_patch` — whichever your harness exposes), **and** present the same content inline in your response. Writing that scratch file is what closes the planning session in baz's timeline — the baz plugin's `postToolUse` hook watches for it and injects the follow-up instruction telling you to call `mcp__baz__complete_session`. This scratch file is exempt from the "read-only until approval" rule (see the intro). After the user approves the plan, save it to `baz-plan.md` if they want it persisted.

Add diagrams alongside the prose where they clarify the change — Markdown ```mermaid``` blocks render in all three harnesses:
- an **ERD** (`erDiagram`) when the change touches a data model / schema;
- a **flow or sequence diagram** when the change introduces a non-trivial control or data flow.

```markdown
# <title>

## Context
Why this change is being made — the problem, what prompted it, the intended outcome.

## Affected repos & files
- `<repo> · <path>` — what changes here and why
  (works for repos not checked out locally — that's the point of Baz)

## Change sequence
1. Ordered steps to implement.

## Diagrams
ERD for data-model changes and/or a flow/sequence diagram for non-trivial flows, as ```mermaid``` blocks. `_None._` if neither applies.

## Cross-repo coordination
Anything that must land together across repos. `_None — single-repo change._` if not applicable.

## Open questions
Things the user should decide before implementation begins.

## Verification
How to test the change end-to-end (run the code, MCP tools, tests).
```

## Step 4: Get approval

Present the plan and ask the user to approve before any implementation begins (on Claude Code, exit plan mode to request approval). Do not start editing until they say go.
