---
name: review
description: >
  Review code changes with Baz indexed search — a diff-scoped code review that
  checks the change against the rest of the org's repos, not just the files in
  front of it. Use when asked to review changes, review a diff or branch,
  review a pull request, check changes for bugs or security issues, or find
  what is wrong with the current changes before pushing. Invoke with
  /baz:review; supports committed / uncommitted / --base / --pr scopes and an
  optional --fix loop that applies the fixes it finds.
argument-hint: "[committed|uncommitted] [--base <branch>] [--pr <number|url>] [--include-untracked] [--fix]"
license: MIT
---

# Review with Baz

Review a set of changes and report what is actually wrong with them. `$ARGUMENTS` carries the scope flags (all optional).

What makes this review different from reading the diff yourself: **Baz's indexed search lets you check the change against code that isn't in this checkout.** A signature change that looks safe here can break a caller in another repo. Finding that is the point of this command — see Step 3.

Reviewing is **read-only**. Do not edit files, amend commits, or push. The one exception is the `--fix` loop in Step 6, which runs only after the user approves specific findings.

## Step 1: Resolve the scope

Parse `$ARGUMENTS`, then build the diff. Default base is the remote default branch (`git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main`, then `master`); `--base <branch>` overrides it.

| Argument | What to review | How to get it |
|---|---|---|
| *(none)* | Everything not yet on the base branch — commits on this branch **plus** uncommitted tracked edits | `git diff $(git merge-base <base> HEAD)` |
| `committed` | Only commits on this branch | `git diff <base>...HEAD` |
| `uncommitted` | Only staged + unstaged edits to tracked files | `git diff HEAD` |
| `--include-untracked` | Adds new files git isn't tracking yet | `git ls-files --others --exclude-standard`, then read each |
| `--pr <number\|url>` | An open pull request | `gh pr diff <n>` (or `glab mr diff <n>`) |

Notes:

- `--pr` needs `gh`/`glab` on PATH and authenticated. If it isn't, say so and offer the branch-based scopes instead — don't fall back silently to a different diff than the user asked for.
- Get the file list with `--name-status` first, then pull the diff. If the diff is very large, review it in file batches rather than truncating — a truncated diff produces a review that silently skips files, which is worse than a slower one.
- **Empty diff is a result, not an error.** Report that the scope is empty and name the scope you resolved (base branch, commit range) so the user can correct it.

State the resolved scope in one line before reviewing — base branch, number of files, number of commits — so the user can see immediately if you're looking at the wrong thing.

## Step 2: Understand the change before judging it

Read the changed files around the hunks. A diff hides the calling context, the early return above it, the lock that's already held. Most false findings come from reviewing hunks in isolation.

Do not report anything until you can name the concrete conditions that trigger it.

## Step 3: Check the change against the rest of the org — the Baz step

**Load and follow the `baz-codebase-exploration` skill** (Skill tool on Claude Code; already an always-on rule on Cursor). It owns tool routing, the search budget, and the verify-before-you-assert rule; everything below is what to point those tools at during a review. As there, all searching goes through Baz — `repo_search`, `remote_grep`, `remote_file_search` — never a shell walk of another repo, and you must pass `sessionId`, `sessionRepository`, and `agentVendor` (from the SessionStart context) on every Baz call.

Run these checks in priority order, and stop when the search budget (10 calls) is spent:

1. **Broken consumers across repos.** For every symbol the diff changes in an outward-facing way — a changed or removed function signature, an altered response shape or field name, a renamed event/topic, a modified DB column, a bumped API version, a deleted export — `remote_grep` the identifier across the org and read the hits. A call site that still passes the old shape is a **blocking** finding, and it is one this review is uniquely able to find. Say which repo and file it lives in.
2. **Both sides of a contract.** If the change touches one end of a request/response, event payload, or schema, verify the other end handles it — even when the other end is a repo the user hasn't cloned. Do not assume it was updated in a sibling PR; check, and if you genuinely can't tell, say so explicitly rather than staying silent.
3. **Diverging from an existing peer.** If the change adds another case to an existing set — another enum value, another handler, another provider, another route — grep an existing peer's identifier once. Its hits enumerate every place the set is registered: the enum, factory maps, switch arms, dispatch tables, route tables, config, and the peer's tests. **Every registration site the new case is missing from is a finding.** This is the single most common real defect in "add one more X" changes.
4. **Reinventing something that exists.** If the change hand-rolls a retry, a validator, a date parser, or a client the org already has, one `repo_search`/`remote_grep` will surface it. Report it only when the existing helper is a genuine drop-in — a speculative "maybe there's a util for this" is noise.

If the diff is purely local (formatting, a private helper, a test-only edit) with no outward-facing surface, skip this step and say you skipped it. Burning ten searches on a rename that touches nothing is worse than not searching.

## Step 4: Review the change itself

Alongside the cross-repo checks, look for:

- **Correctness** — logic that produces the wrong result, off-by-one, inverted conditions, unhandled `null`/empty/error returns, wrong operator precedence.
- **Concurrency & state** — race conditions, non-atomic read-modify-write, missing idempotency on retryable handlers, shared mutable state.
- **Security** — injection (SQL, shell, path), missing authn/authz on a new endpoint, unverified webhook signatures, secrets or tokens in code/logs, unsafe deserialization, user input reaching a sink unvalidated.
- **Failure handling** — swallowed exceptions, unbounded retries, missing timeouts, partial writes with no rollback.
- **Regressions** — behavior the change removes or alters that existing callers or tests depend on.
- **Tests** — new branching logic with no test covering it; an existing test whose assertion the change invalidates.

**What not to report.** Style, formatting, naming preferences, and speculative "consider extracting this" refactors are noise unless they cause a defect. Do not report pre-existing problems the diff didn't introduce or touch. Do not report something you could not verify by reading the source — verify or drop it.

## Step 5: Report

Group findings by severity, most severe first. Every finding needs a `file:line`, the concrete conditions under which it fails, and a fix. Cross-repo findings name the other repo.

```markdown
## Review — <scope, base branch, N files>

### Blocking
1. **<one-line claim>** — `<repo?> · <path>:<line>`
   Fails when: <concrete inputs or state → wrong result, crash, or breach>
   Fix: <what to change>

### Should fix
...

### Consider
...

## Summary
<N blocking, N should-fix, N consider.> <One line: is this safe to merge?>
```

Emit every heading in order; write `_None._` under any that are empty. If there is nothing to report, say the change looks correct and name what you checked — including which repos you searched and found clean. A clean review that lists its coverage is useful; a bare "LGTM" isn't.

## Step 6: Fix (only with `--fix`, or when the user asks)

Turn the findings into a task list — one task per finding, blocking first — and show it before touching anything. Then work through it:

- Fix one finding per edit, in the repo that's checked out. Report findings in other repos; don't try to edit code you don't have.
- After each fix, re-read the changed region to confirm the fix actually lands and doesn't break a neighbouring path.
- Run the project's tests and linter if the repo has them. Report failures with the output — never claim green without running them.
- Skip anything ambiguous, architectural, or wider than the finding, and say why. Ask rather than guess.

Finish with what was fixed, what was skipped and why, and what still needs a human.
