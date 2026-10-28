---
title: Docs drift check
summary: Compare product docs and AGENTS.md against the code and open a PR fixing anything that no longer matches.
owner: Daniel Tse
last_verified: 2026-10-27
status: current
standard_version: 1.0
---

# Docs drift check

## Purpose

Keep docs true without anyone having to remember. Docs that drift become docs nobody trusts.

## When to use / when not to

- Use on a weekly schedule, and after any large merge.
- Don't use mid-feature on a work branch. Run it against `main`.

## Inputs

- None. Optionally a single feature or subsystem file to check.

## Reads

- Every file in `docs/product/` and its `code_paths`
- The code under each file's `code_paths`
- `git log --since="<that file's last_verified>" -- <code_paths>` for each file
- `AGENTS.md` and the commands it lists

## Writes

- Corrections to `docs/product/*` and `AGENTS.md` on branch `docs/drift-YYYY-MM-DD`
- Updated `last_verified` on every page checked and confirmed accurate
- One PR, or nothing if no drift was found

## Permissions

Read the repo, run the commands listed in `AGENTS.md`, write `docs/` and `AGENTS.md` on the drift branch, `gh pr create`.

## Steps

1. For each product page, list commits to its `code_paths` since its `last_verified` date.
2. If there are none, confirm the page still reads correctly and update `last_verified`.
3. If there are commits, read the changes and check each statement on the page against the code. Fix what's wrong. Pay special attention to availability tables.
4. Look for user-facing behaviour in the code that no feature file mentions. Add it, or add an Open question.
5. Run every command in `AGENTS.md`. Fix any that fail or have changed.
6. Run `python3 scripts/docs_check.py`.
7. If anything changed, open a PR listing each correction with the commit that caused the drift. If nothing changed but dates were refreshed, still open the PR so the refresh is reviewed.

## Done when

- [ ] Every product page was checked against its `code_paths`
- [ ] Every correction cites the commit that caused it
- [ ] docs check passes

## Output

PR titled `Docs drift check YYYY-MM-DD`, or a note that no drift was found.
