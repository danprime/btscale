---
title: Spec writer
summary: Turn an interactive exploration, mockup or idea into a spec that someone else can build from.
owner: Daniel Tse
last_verified: 2026-10-27
status: current
standard_version: 1.0
---

# Spec writer

## Purpose

Capture what was decided during exploration so the build can be handed off to another person or an unattended agent.

## When to use / when not to

- Use when a direction is locked in: a mockup is approved, a proof of concept works, or an idea has passed feasibility review.
- Don't use for one-line fixes. The issue description is enough.

## Inputs

- The issue number. If none exists, create one first (`gh issue create`) and ask the person to confirm the title.
- The conversation or prototype the decisions came from.

## Reads

- The issue and comments
- `docs/product/constraints.md`, `docs/product/features/index.md` and related feature files
- Related `docs/decisions/`
- The prototype branch or mockup, if any

## Writes

- `docs/specs/<issue>-<short-name>.md` (from `docs/specs/_template.md`)
- A comment on the issue linking the spec

## Permissions

File writes in `docs/specs/`, `git` on a branch, `gh issue comment`.

## Steps

1. Copy `docs/specs/_template.md` to `docs/specs/<issue>-<short-name>.md`.
2. Fill Goal, Users, and Decisions from the exploration. Decisions list what was chosen AND what was rejected, with one line of why.
3. Write acceptance criteria as testable statements ("Given..., when..., then...").
4. Write test cases, including at least one edge case per availability condition in the related feature file.
5. List anything not decided under Open questions. Do not invent answers.
6. Check the spec against `constraints.md`. If it breaks a constraint, stop and flag it.
7. If a decision is significant beyond this feature, run `decision-record` for it.
8. Commit on the work branch and comment on the issue: `Spec: docs/specs/<file>`.

## Done when

- [ ] Every acceptance criterion is testable
- [ ] Open questions are listed, not guessed
- [ ] Spec is linked from the issue

## Output

The spec file, and an issue comment linking it.
