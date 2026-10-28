---
title: Decision record
summary: Write a short record of a significant decision so future readers know what was chosen and why.
owner: Daniel Tse
last_verified: 2026-10-27
status: current
standard_version: 1.0
---

# Decision record

## Purpose

Keep the "why" behind the product and code, so nobody has to reverse-engineer it or re-argue it.

## When to use / when not to

- Use when a choice was made between real alternatives and someone might later ask why: a library, a data format, an architecture, a scope cut, a UX direction.
- Don't use for routine implementation detail that the code makes obvious.

## Inputs

- The decision, the alternatives considered, and the reasoning.

## Reads

- `docs/decisions/` (to find the next number and any decision this replaces)
- `docs/product/decisions.md` (the index)

## Writes

- `docs/decisions/NNNN-<short-name>.md` from `docs/decisions/0000-template.md`
- A new row in `docs/product/decisions.md`
- If it replaces an older decision, set the older one's status to `superseded by NNNN`

## Permissions

File writes in `docs/decisions/` and `docs/product/decisions.md`.

## Steps

1. Find the highest existing number and add one, zero-padded to four digits.
2. Copy the template. Fill Context, Decision, Alternatives (each with one line on why not), Consequences.
3. Keep it under one screen. Link to the spec or issue for detail.
4. Add a row to `docs/product/decisions.md`, written in plain English for non-developers.
5. If it supersedes an older record, update that record's status line.

## Done when

- [ ] Alternatives are listed with reasons
- [ ] Index row added in plain English

## Output

The decision file and the index row.
