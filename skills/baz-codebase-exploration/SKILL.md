---
name: baz-codebase-exploration
description: >
  Procedure for exploring repositories with Baz's indexed search tools.
  Use when asked to plan a feature, design a change, scope work, or
  investigate where to make changes across the org's repos. Applies even
  when you own one side of a cross-repo contract (API param, schema, event
  payload) locally, and especially when the relevant repositories are not
  checked out locally. Baz's MCP tools are how you search code across the
  org; once you know a file's path, read it however you like.
license: MIT
---

# Baz Codebase Exploration

This skill helps you plan a change across your org's repos using indexed search. It applies whether or not the relevant repos are checked out locally — and **especially when a change crosses a contract boundary between repos**: you edit one side, another repo defines the other. **Baz MCP tools are how you search code across the org.** Once you know a file's path, read it however you like — local `Read` if the repo is checked out, otherwise your own fetch.

## When to use this skill

- The user asks to plan a feature, scope a change, or design an implementation
- The change might touch more than one repository in the org
- You own one side of a cross-repo contract (API param, request/response schema, event payload) — **even when that side is checked out locally**
- The relevant code lives in repos the user has not cloned locally

## Tool routing — strict

| Job | Tool |
|---|---|
| Find which repos are involved | `repo_search` (Baz) |
| Find code by symbol / regex inside a repo | `remote_grep` (Baz) |
| Find files by name / glob inside a repo | `remote_file_search` (Baz) |

**Forbidden — every kind of search goes through a Baz tool, never through your read or shell tool.** These are the patterns that cause the most waste:

- Do **not** list or walk a repo's file tree to find files — no directory listing, no recursive tree fetch (e.g. `gh api .../contents/<dir>`, `gh api .../git/trees/HEAD?recursive=1`, `ls`/`find` over a checkout). Use `remote_file_search`.
- Do **not** crawl or scan a repo's contents to find a symbol or string (e.g. `gh search code`, grepping fetched files). Use `remote_grep`.
- Do **not** use your file-read mechanism (local `Read`, `gh api .../contents/<path>`, `curl`, …) for anything except opening **one already-known file path**. Pointing it at a directory, or firing several to "look around", is a search — route it through `remote_file_search` / `remote_grep`. The read tool is the *last* step, never the exploration.

## Recommended flow

### Step 1: Orient (once)

If the user has not told you which repo(s) to look in, call `repo_search` **exactly once** with broad keywords:

```text
repo_search(keywords: ["<topic>", "<topic synonym>"], domains?: ["API", "BUSINESS_LOGIC", ...])
```

Read the returned `{repoId, repoName, domain, summary}` entries and pick the most likely repos using your own judgement (results are not LLM-ranked). Use that identifier **verbatim** in later tools — don't guess `repository` from a local folder or service name (the index may name it differently), and note a service is often indexed as a subdirectory of a larger repo, so prefix `path` accordingly.

**If the result is empty or too large**, do **not** re-call `repo_search` with rephrased keywords. Instead:
- For empty: pick a likely repo by name and skip to Step 2.
- For too-large (`exceeds maximum allowed tokens`): re-call **once** with a `domains` filter to narrow scope.

### Step 2: Locate code inside the repo

When you have a symbol / string / regex, grep inside the repo:

```text
remote_grep(repository: "<repo>", pattern: "<regex>", path: "<dir-or-.>")
```

Results group matches by file with line numbers and ~2 lines of context per match.

When you only have a naming hunch (no symbol yet), use the file-name search:

```text
remote_file_search(repository: "<repo>", pattern: "**/*router*.ts")
```

The pattern must contain a naming token. Do **not** call `remote_file_search` with a bare extension (`**/*.ts`, `**/*.go`) — that returns a 50-file slice of an unknown directory and wastes a call. If you don't have a naming hunch, run `remote_grep` for a symbol instead.

Baz tools accept a `repository` argument — either the short leaf name (e.g. `baz`) or the full `owner/repo` (e.g. `org/baz`); pass the full form if the short name is ambiguous across the org. They default to the repo's default branch HEAD, and any `ref` argument accepts a branch name or a 7–40 character hex commit SHA (case-insensitive).

**Search budget — strict.** Each MCP search call costs ~3s. Two limits, both hard:

- **Per pair:** after **3** searches on the same `(repository, path)` pair you MUST open/read at least one matched file — local `Read` if the repo is checked out, otherwise your own fetch — before issuing a 4th search on that pair. Rephrasing OR-alternations of the same concern (`foo|Foo|foo_bar`) on the same path is forbidden — the first call already returned everything that matches; if it didn't, the term is wrong (not under-tokenized) and you should pick a different symbol or read a file.
- **Total:** **at most 10 search calls** for the whole planning run — every repo and path combined, not per pair. If you reach 10 and still haven't found a keystone, stop searching and read the most promising file you've already surfaced; the answer is almost always reachable from a file you've already seen, not from an 11th search. Hopping to a new `(repo, path)` pair does not reset this count.

**Adding one more case to an existing set?** — another value in an enum, another implementation of an interface, another branch in a dispatcher (a new type, provider, command, route, event, or handler). The most common planning miss is leaving out a place the new case must be registered. Before finalizing, run ONE repo-wide search for the identifier of an **existing peer** in that set — grep the name of a sibling value or class already in the codebase. Its hits enumerate every site the set is wired through: the enum / constant list, factory or lookup maps, switch / match arms, dispatch or handler tables, route tables, and config. Your plan must add the new case at each site. This is a single cheap search, not a wide read — it surfaces the registration points that reading only one sibling's own implementation file misses. Skim that sibling's tests too: an existing assertion that your new case is absent or unsupported will need updating. Every site this sweep surfaces must be addressed in the plan as a concrete required change (or explicitly ruled out with a reason) — do not leave a surfaced site as an open question.

### Step 3: Read a matched file

Once you have a concrete file path from Step 2, open it — use your local `Read` if the repo is checked out, otherwise fetch it however you normally would (Baz has no whole-file read tool). Read **one known path per call**; never point your read/fetch tool at a directory.

If you find yourself wanting to *look around* (list a directory, walk a tree), stop and go back to Step 2 — that's a search, not a read.

### Step 4: Produce the plan

If the change depends on something in another repo — an API, schema, or contract you don't own — verify it from source with Baz before finalizing, rather than assuming it's already in place.

**Open questions are only for decisions a person must make** — product scope, editable-vs-read-only, which behavior is intended. They are **not** a place to defer code you found but didn't check. If your peer-enumeration sweep (or any search) surfaces an internal touch-point — a sibling classifier, a walker, a registration site, a config — **read it and either include the change as a required step or state concretely why it is not needed.** Never park a discovered internal touch-point as a "confirm?" open question; that reads as an omission, not diligence.

The "verify or flag" caution applies **only to genuinely external/third-party behavior** you cannot read from source — a remote API's semantics, an SDK's data shapes, a file format's rules. Even then, prefer verifying it from source with the indexed-search tools before assuming; only note it as an open question if it is truly unknowable from the code.

**Span the stack — is this layer the builder or a proxy?** Before you commit to the layer you found, confirm it's the one that actually *builds* the thing you're changing, not one that merely forwards it. A single feature (an API response, an event, a record) often crosses language/service boundaries within one repo — e.g. a TypeScript BFF endpoint that proxies a response actually constructed by a Rust `platform/` crate. If you find a handler that returns or re-exposes data without defining its shape, keep searching *upstream* (other directories, other language stacks like `platform/crates`, `src/`, `pkg/`) for where the shape is defined. Naming the proxy instead of the builder means the planned change wouldn't actually take effect.

**Verify before you assert.** Never state that code *already* does something — already returns a field, already handles a case, already registered, is already wired — based on a name, a type, or a nearby file. Open the definition and read it. Most wrong plans come from an unverified "this is already handled" assumption that a look at the source would have disproved. If you catch yourself inferring behavior instead of confirming it, that's a signal to read the file.

Based on what you found, propose:

- The files that need to change (with repo + path)
- The order to make changes in
- Any cross-repo coordination needed
- Open questions the user should answer before implementation begins

## Things to avoid

- Do **not** ask the user to clone repos for you.
- Do **not** re-query `repo_search` with rephrased keywords. One call, then pick a repo.
- Do **not** bulk-crawl or list a repo's tree to search — use `remote_file_search` / `remote_grep`.
- Do **not** delegate this exploration to a generic or local-only subagent (e.g. a plain `Explore` agent) — it silently falls back to local Read/Grep and skips Baz. If you spawn a subagent and the work reaches code outside the local checkout (another repo, or the side of a contract you don't own), its prompt **must** tell it to use the Baz MCP tools (`repo_search` / `remote_grep` / `remote_file_search`) per this skill's routing rules.

## Search-call arguments — required

The baz plugin's SessionStart hook injects your `sessionId`, the cwd repo (`sessionRepository`), and the client name (`agentVendor`, e.g. `claude-code`, `codex`, `cursor`) into your context. **You MUST pass all three as arguments on every call to `repo_search`, `remote_grep`, and `remote_file_search`.** Without them, baz cannot correlate your tool calls to a session and the calls are not recorded against your session in Baz. This is non-negotiable — treat the values as required, not optional, regardless of what the tool schema marks them as.

This skill covers search only. What to do with a finished plan — writing it, and whether to upload it to Baz — belongs to the planning flow, not here: see the `plan-with-baz` skill, or follow the instruction the baz plugin's hooks inject when planning ends.
