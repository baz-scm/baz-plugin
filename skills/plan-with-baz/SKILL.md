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

**Load and follow the `baz-codebase-exploration` skill for every search, read, and planning decision in this run.** It is the authoritative source for tool routing, the search budget, the builder-vs-proxy and verify-before-you-assert checks, and the "enumerate an existing peer's registration sites" completeness rule. Invoke it now (via the Skill tool on Claude Code; on Cursor it is already applied as an always-on rule) and treat its rules as binding. This wrapper owns only the wrapper concerns — plan mode (Step 1), the plan-document schema and baz session close (Step 3), and approval (Step 4).

If for any reason that skill is not in your context, these non-negotiables still apply — but prefer the full skill:

| Job | Tool |
|---|---|
| Find which repos are involved | `repo_search` (Baz) |
| Find code by symbol / regex inside a repo | `remote_grep` (Baz) |
| Find files by name / glob inside a repo | `remote_file_search` (Baz) |
| Read one file whose path you already know | your read tool — local `Read` if checked out, otherwise your own fetch |

- **All searching goes through Baz** — never list, walk, or grep a repo with your read or shell tool. Recursive tree fetches or `ls`/`find` to "look around" are searches; route them through `remote_file_search` / `remote_grep`. Your read tool is only for opening one already-known file path.
- **Search budget (hard):** call `repo_search` once and don't rephrase keywords; after 3 searches on the same `(repository, path)` pair, read a matched file before searching that pair again; use **at most 10 searches total** for the whole run — all repos and paths combined, and hopping to a new pair does **not** reset the count.
- **Adding one more case to an existing set** (another enum value, another implementation of an interface, another branch in a dispatcher): before finalizing, run ONE repo-wide search for the identifier of an **existing peer** already in that set. Its hits enumerate every site the set is wired through — the enum / constant list, factory or lookup maps, switch / match arms, dispatch or handler tables, route tables, and config — and your plan must add the new case at each. Skim that peer's tests too, in case an assertion that your case is absent needs updating.

## Step 3: Write the plan

Produce the plan in the fixed schema below — **always emit every section heading, in this order**, even when a section is empty (write `_None._` rather than dropping the heading). The stable shape is the contract a future "share / push to Baz" step will parse.

Where to put it:
- **Claude Code**: write it to the plan file plan mode gives you (writing that file is what plan mode is for).
- **Codex** (no plan mode): write the plan to `/tmp/.baz-plan-<sessionId>.md` using `apply_patch` (or your equivalent file-write tool), **and** present the same content inline in your response. The baz plugin's `postToolUse` hook watches for that write and prompts you to ask about uploading. This scratch file is exempt from the "read-only until approval" rule (see the intro). After the user approves the plan, save it to `baz-plan.md` if they want it persisted.
- **Cursor** (no plan mode, no postToolUse prompt): write the plan to `/tmp/.baz-plan-<sessionId>.md` with `edit_file` / `write_file` / `Write` / `Edit`, **and** present the same content inline. Cursor drops the postToolUse `additionalContext` for non-MCP tools, so no automated prompt will arrive — raise the upload question yourself (Step 5). This scratch file is exempt from the "read-only until approval" rule (see the intro). After the user approves the plan, save it to `baz-plan.md` if they want it persisted.

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

## Step 5: Offer to upload the plan to Baz

Writing the plan file is local and needs no permission. Uploading is different: `mcp__baz__update_plan` (fully qualified — `update_plan` alone is not a callable tool name) publishes the plan to your organization's Baz timeline, where teammates can open, comment on, and review it. **That is never automatic — ask the user and wait for their answer.**

- **If they say yes**: call `mcp__baz__update_plan`, following the call shape the hook's instruction gives you. Where it says the arguments are attached for you, pass none — re-typing the plan wastes tokens and risks drift. Where it supplies authoritative `content` / `tokensUsed` / `modelId` / `repoNames` values (Codex and Cursor), pass those exactly as given rather than your own recollection or estimates. The tool result contains a **shareable plan link** — include it in your reply so the user can open the plan.
- **If they say no**: don't call it, and don't raise it again this session. The planner session stays open in baz's timeline; that's the accepted cost of not uploading.
- Ask **once** per planning session — consent covers the session, not one specific call. A hook may prompt you more than once for the same plan (on Claude Code it fires when the plan file is written, and again on approval). Don't re-ask; reuse the answer you already have. **If it was yes, call `update_plan` again**, so the version the user approved is what ends up on the timeline — the latest plan text is what gets sent, whether the hook attaches it or you pass it inline. A redundant call is harmless — identical content is deduped server-side by content hash — but a skipped one leaves an unapproved draft as the final plan.

A hook instruction telling you to call `update_plan` is a prompt to **ask**, not the user's permission. Only a direct answer from the user is consent.

Per-platform mechanics:
- **Claude Code and Codex**: a PostToolUse hook watches the plan-file write and injects the upload question along with the authoritative values.
- **Cursor**: no PostToolUse prompt is delivered (Cursor drops `additionalContext` from non-MCP-tool hooks), so raise the question yourself right after the file write. Token counts aren't available client-side and should be omitted.
