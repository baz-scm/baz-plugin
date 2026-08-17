---
name: plan-with-baz
description: >
  Plan a feature or change end-to-end using Baz indexed search across your
  org's repos. Explores the relevant repos with Baz's MCP tools and produces a
  structured implementation plan the user signs off on before any code is
  written. Invoke with
  /baz:plan-with-baz when you want to start planning a piece of work.
disable-model-invocation: true
argument-hint: [feature or change to plan]
license: MIT
---

# Plan with Baz

You were invoked explicitly to plan a piece of work using Baz's indexed search. The work to plan is in `$ARGUMENTS` (if empty, ask the user what they want to plan).

This is a **read-only** procedure. Do not edit project files, run mutating commands, or start implementing until the user picks **Implement** in Step 3. The only write allowed before then is the plan document itself (see Step 2).

## Step 1: Explore with Baz

**Load and follow the `baz-codebase-exploration` skill for every search, read, and planning decision in this run.** It is the authoritative source for tool routing, the search budget, the builder-vs-proxy and verify-before-you-assert checks, and the "enumerate an existing peer's registration sites" completeness rule. Invoke it now (via the Skill tool on Claude Code; on Cursor it is already applied as an always-on rule) and treat its rules as binding. This wrapper owns only the wrapper concerns — the plan-document schema and baz session close (Step 2), and the implement / upload / change choice (Step 3).

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

## Step 2: Write the plan

Produce the plan in the schema below, **emitting every heading, in this order**. The stable shape is the contract the Baz product parses when the plan is rendered.

Where to put it: write the plan to `/tmp/.baz-plan-<sessionId>.md` with your file-write tool (`Write`/`Edit` on Claude Code, `apply_patch` on Codex, `edit_file`/`write_file` on Cursor), **and present the same content inline** in your response so the user can read it without opening a file. That write is what tells the baz plugin planning is done; it is a scratch file outside the project, so it is exempt from the "read-only until Step 3" rule (see the intro). If the harness refuses the write, present the plan inline and carry on. If the user later wants the plan kept in the repo, save it to `baz-plan.md` then.

Per-harness notes:
- **Claude Code / Codex**: a `postToolUse` hook watches that write and hands you the Step 3 choices along with the authoritative upload arguments.
- **Cursor**: Cursor drops `additionalContext` for non-MCP tools, so no hook prompt arrives — present the Step 3 choices yourself.

Two layers, split by the `---` rule: above it is what a reviewer approves on, below it is what an implementer follows. Someone who was not in the session should be able to say yes or no without unfolding the bottom half.

```markdown
# <title>

## Why
The problem and the intended outcome. A few sentences.

## The change
Open with **one paragraph, four sentences at most**, in plain language: what you
are going to do and how it works once it lands. Someone who knows the product but
not this code should follow it without reading anything below. No file paths.

Then a **Before / After table** tracing one thing through the system (a request,
a job, a record), one row per step, at most six rows, so the change reads across
each row instead of by diffing two blocks:

| Step | Today | After |
| --- | --- | --- |
| <what happens at this point> | <current behaviour> | <what differs, or "unchanged"> |

Mark every cell **(new)**, **(changed)** or **(unchanged)**, using those three
words everywhere in the plan. The unchanged ones are what show how much is being
reused. Keep cells to one line; a step needing more than that is really two steps.

No ASCII diagrams. Plans are read as rendered Markdown, where indentation-aligned
art becomes a striped, unreadable block.

Then one ```mermaid``` `sequenceDiagram` tracing the same journey at runtime:
who calls whom, in order, ending where the result lands. Mark every participant
and message with the same three words. Keep it under six participants and ten
messages. Past that it stops being readable, and the excess belongs in Steps.

Use `erDiagram` instead when the change is mostly tables and columns, or
`flowchart TD` when there is no runtime sequence to trace. One diagram; a second
only if it answers a different question.

## Decisions
One bullet each, opening with a **bold few-word title** naming the choice, then
two sentences at most:

- **<Choice, a few words>.** Chose <A> over <B>, because <why, grounded in the code>. Cost: <what becomes harder>.

Do not list the files a decision touches; those belong to the step that makes the
change. Close with one bullet titled **Out of scope**.

## Open questions
Only what genuinely blocks a decision. `_None._` otherwise. A question you could
answer by reading the code is not an open question, it is unfinished research.

---

## Steps
Ordered, **one sentence each**, naming at most two paths. No sub-bullets.

When a change repeats across sites, give the pattern and the scale, not the
list: *"wherever `<existing peer>` appears, about eight deployment files"*. The
implementer greps for the peer and finds them all, including any you missed.

Write for someone who reads the code as well as you do: do not explain what they
will find on opening a file, restate reasoning from Decisions, or spell out a
diff. Mark the load-bearing step. Where steps span repos, say what must land
before what.

## Verification
**Automated:** literal commands that prove it works.
**Manual:** what a human must confirm.
```

What goes in:

- Keep what changes the right answer: a constraint, a tradeoff you settled. Leave out what the implementer re-derives by opening the file.
- Describe a repeated change once: name the pattern, give two or three representative paths, never one bullet per file.
- No em dashes. Use a colon, a comma, or two sentences.

## Step 3: Offer the three choices

With the plan written and shown inline, ask the user what to do next. Offer exactly these three, in this order (on Claude Code use `AskUserQuestion`, which supplies the free-text option itself; elsewhere list them in your message):

1. **Implement** — start executing the plan in this session.
2. **Upload to Baz** — publish the plan so teammates can read and comment on it.
3. **Change something** — leave it open for the user to type what they want different.

Then act on the answer:

- **Implement**: the read-only rule is lifted. Work through Steps in order. Do not upload; the user declined by choosing something else, so don't raise uploading again this session.
- **Upload to Baz**: upload per Step 4, show the plan link, then come back and offer **Implement** / **Change something** again.
- **Change something**: revise the plan, rewrite `/tmp/.baz-plan-<sessionId>.md` with the new text, present it, and offer the three choices again. Stay read-only.

Nothing here is a default. Do not implement and do not upload until the user answers.

## Step 4: Upload the plan to Baz

Writing the plan file is local and needs no permission. Uploading is different: `mcp__baz__update_plan` (fully qualified — `update_plan` alone is not a callable tool name) publishes the plan to your organization's Baz timeline, where teammates can open, comment on, and review it. **That is never automatic — the user choosing "Upload to Baz" in Step 3 is the only thing that authorizes it.**

- **On upload**: call `mcp__baz__update_plan`, following the call shape the hook's instruction gives you. Where it says the arguments are attached for you, pass none — re-typing the plan wastes tokens and risks drift. Where it supplies authoritative `content` / `tokensUsed` / `modelId` / `repoNames` values (Codex and Cursor), pass those exactly as given rather than your own recollection or estimates. The tool result contains a **shareable plan link** — include it in your reply so the user can open the plan, and tell them they can run `/baz:plan-comments` any time to pull the plan's comments back into this session.
- **If the user picked Implement or Change something**: don't call it, and don't raise uploading again this session. The planner session stays open in baz's timeline; that's the accepted cost of not uploading.
- Ask **once** per planning session — the answer covers the session, not one specific call. A hook may prompt you more than once for the same plan (it fires on every plan-file write, so a revision re-triggers it). Don't re-ask the upload question; reuse the answer you already have. **If it was upload, call `update_plan` again after a revision**, so the version the user settled on is what ends up on the timeline — the latest plan text is what gets sent, whether the hook attaches it or you pass it inline. A redundant call is harmless — identical content is deduped server-side by content hash — but a skipped one leaves a stale draft as the final plan.

A hook instruction telling you to call `update_plan` is a prompt to **offer the choices**, not the user's permission. Only a direct answer from the user is consent.

Per-platform mechanics:
- **Claude Code and Codex**: a PostToolUse hook watches the plan-file write and injects the choices along with the authoritative values.
- **Cursor**: no PostToolUse prompt is delivered (Cursor drops `additionalContext` from non-MCP-tool hooks), so present the choices yourself right after the file write. Token counts aren't available client-side and should be omitted.
