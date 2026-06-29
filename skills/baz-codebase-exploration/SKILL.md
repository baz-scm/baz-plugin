---
name: baz-codebase-exploration
description: >
  Procedure for exploring repositories with Baz's indexed search tools.
  Use when asked to plan a feature, design a change, scope work, or
  investigate where to make changes across the org's repos. Applies even
  when you own one side of a cross-repo contract (API param, schema, event
  payload) locally, and especially when the relevant repositories are not
  checked out locally. Baz's MCP tools replace `gh` / `glab` for code search
  across the org; `gh` / `glab` are only for reading specific files once you
  know the path.
license: MIT
---

# Baz Codebase Exploration

This skill helps you plan a change across your org's repos using indexed search. It applies whether or not the relevant repos are checked out locally — and **especially when a change crosses a contract boundary between repos**: you edit one side, another repo defines the other. **Baz MCP tools replace `gh` / `glab` for code search.** Use `gh` / `glab` only to read a specific file once you already know its path.

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
| Read a specific file you already know the path of | `gh api repos/<owner>/<repo>/contents/<path>` |

**Forbidden — these are the patterns that cause the most waste:**

- Do **not** call `gh api repos/<owner>/<repo>/git/trees/HEAD?recursive=1`. Use `remote_file_search` instead.
- Do **not** call `gh search code`. Use `remote_grep` instead.
- Do **not** call `remote_file_search` and then `gh api .../git/trees` for the same directory. Pick one — and the answer is always `remote_file_search`.
- Do **not** call `gh api .../contents/<dir>` to walk a directory. That's a search; use `remote_file_search`.

## Recommended flow

### Step 1: Orient (once)

If the user has not told you which repo(s) to look in, call `repo_search` **exactly once** with broad keywords:

```text
repo_search(keywords: ["<topic>", "<topic synonym>"], domains?: ["API", "BUSINESS_LOGIC", ...])
```

Read the returned `{repoId, repoName, domain, summary}` entries and pick the most likely repos using your own judgement (results are not LLM-ranked).

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

**Search budget — strict.** Each MCP search call costs ~3s. After **3** searches on the same `(repository, path)` pair you MUST open at least one matched file via `gh api .../contents/<path>` before issuing a 4th search on that pair. Rephrasing OR-alternations of the same concern (`foo|Foo|foo_bar`) on the same path is forbidden — the first call already returned everything that matches; if it didn't, the term is wrong (not under-tokenized) and you should pick a different symbol or read a file. A good planning run uses fewer than 10 search calls total.

### Step 3: Read whole files (and only known paths)

Once you have a concrete file path from Step 2, fetch the whole file via gh:

```bash
gh api repos/<owner>/<repo>/contents/<path> --jq '.content' | base64 -d
```

If you find yourself wanting to *look around* (list a directory, walk a tree), stop and go back to Step 2 — that's a search, not a read.

### Step 4: Produce the plan

Based on what you found, propose:

- The files that need to change (with repo + path)
- The order to make changes in
- Any cross-repo coordination needed
- Open questions the user should answer before implementation begins

## Things to avoid

- Do **not** ask the user to clone repos for you.
- Do **not** re-query `repo_search` with rephrased keywords. One call, then pick a repo.
- Do **not** run `remote_file_search` and `gh` tree-listing for the same directory.
- Do **not** delegate this exploration to a generic or local-only subagent (e.g. a plain `Explore` agent) — it silently falls back to local Read/Grep and skips Baz. If you spawn a subagent and the work reaches code outside the local checkout (another repo, or the side of a contract you don't own), its prompt **must** tell it to use the Baz MCP tools (`repo_search` / `remote_grep` / `remote_file_search`) per this skill's routing rules.
