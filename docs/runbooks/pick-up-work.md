---
title: Pick up work
summary: Load the full context for an issue or branch before changing any code.
owner: Daniel Tse
last_verified: 2026-10-27
status: current
standard_version: 1.0
---

# Pick up work

## Purpose

Build an accurate picture of where a piece of work stands, from the repo alone, before touching code.

## When to use / when not to

- Use at the start of any session on an existing issue, branch or PR, including work someone else started.
- Don't use for brand-new work with no issue yet. Create the issue first, or use `spec-writer`.

## Inputs

- An issue number, branch name or PR number. If none is given, ask for one.

## Reads

- The issue and its comments (`gh issue view <n> --comments`)
- Any linked PR, its description, review comments and diff (`gh pr view`, `gh pr diff`)
- `docs/specs/<issue>-*.md` if it exists
- `docs/decisions/` entries linked from the spec or touching the same area
- `docs/product/features/index.md`, then only the feature files related to this work
- `git log --oneline -20` on the branch
- `AGENTS.md`

## Writes

Nothing. This skill only reads and reports.

## Permissions

Read-only: `gh issue view`, `gh pr view`, `gh pr diff`, `git log`, `git diff`, file reads.

## Steps

1. Identify the issue, branch and PR. If they don't line up (e.g. a branch with no issue), say so.
2. Read the issue and all comments, oldest first. Note the latest status comment from `session-closeout`.
3. Read the spec if present. If there is no spec and the work isn't trivial, flag it.
4. Read linked decisions and the relevant feature files.
5. Check the branch state: commits since `main`, uncommitted changes, failing checks on the PR.
6. Compare what the spec says is done against what the code shows. Note any mismatch.
7. Write the summary below in chat. Do not start coding until the person confirms the next step,
   unless you are running unattended, in which case state your reading of the next step and proceed.

## Done when

- [ ] Every source listed under Reads that exists has been read
- [ ] Mismatches between spec, issue and code are listed, or stated as none
- [ ] The next step is a concrete action, not "continue working"

## Output

```
Work: #<issue> <title>  (branch: <branch>, PR: #<n> or none)
Goal: <one sentence from the spec or issue>
Done so far: <bullets>
Open questions / decisions pending: <bullets or none>
Mismatches: <spec vs code vs issue, or none>
Next step: <one concrete action>
```
