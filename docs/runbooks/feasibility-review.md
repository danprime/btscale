---
title: Feasibility review
summary: Give a plain-English answer on whether an idea fits the product, how big it is, and what the risks are.
owner: Daniel Tse
last_verified: 2026-10-27
status: current
standard_version: 1.0
---

# Feasibility review

## Purpose

Answer "is this possible, and is it worth it?" for non-developers, using the real code, without pulling a developer in for every question.

## When to use / when not to

- Use when an issue is labelled `idea`, or someone asks whether something is possible.
- Don't use for bugs. Don't start building.

## Inputs

- The issue number.

## Reads

- The issue
- `docs/product/brief.md`, `constraints.md`, `roadmap.md`, `ideas-rejected.md`
- `docs/product/features/index.md` and related feature files
- `docs/product/how-it-works/` and the code under the relevant `code_paths`

## Writes

- One comment on the issue. Nothing else. No branches, no code.

## Permissions

Read-only repo access, `gh issue view`, `gh issue comment`, `gh issue edit --add-label`.

## Steps

1. Restate the idea in one sentence. If it's unclear, comment with the questions needed and stop.
2. Check `ideas-rejected.md`. If it was rejected before, say so, link it, and say whether anything has changed since.
3. Check `constraints.md`. If it breaks a constraint, say which one in plain words.
4. Find where it would live in the code. Identify what exists already and what would be new.
5. Size it: Small (hours), Medium (days), Large (weeks), or Needs discussion.
6. List risks and dependencies (browser support, hardware, data, privacy, cost).
7. Offer a cheaper alternative if one gets most of the value.
8. Post the comment. Add label `feasible`, `needs-discussion` or `not-feasible`.

## Done when

- [ ] Answer is readable by a non-developer
- [ ] Size and risks are stated
- [ ] A label is applied

## Output

```
Idea: <one sentence>
Fit: <fits / partly fits / doesn't fit> because <reason>
Size: <Small | Medium | Large | Needs discussion>
What exists already: <plain English>
What would be new: <plain English>
Risks: <bullets>
Cheaper alternative: <or none>
For developers: <file paths and notes>
```
