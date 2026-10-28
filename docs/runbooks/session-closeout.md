---
title: Session closeout
summary: Write everything learned in a session back into the repo so anyone can pick it up without the chat history.
owner: Daniel Tse
last_verified: 2026-10-27
status: current
standard_version: 1.0
---

# Session closeout

## Purpose

Make the repo, not the chat, the record of what happened. After closeout, someone with no access to this session can continue the work.

## When to use / when not to

- Use at the end of any meaningful session, before a handoff, and at the end of every automated run.
- Use before stopping even if the work is unfinished. Unfinished work needs closeout most.
- Don't use for read-only questions that changed nothing.

## Inputs

- The issue number and branch for the work.

## Reads

- `git diff main...HEAD` and uncommitted changes
- The spec, the issue, and the related feature files
- The session itself (what was tried, decided, rejected)

## Writes

- `docs/specs/<issue>-*.md`: update Status, Done, Next steps, Open questions, Decisions
- `docs/decisions/NNNN-*.md` via `decision-record`, for each significant decision
- `docs/product/features/*` and `docs/product/roadmap.md`, only if user-visible behaviour or plans changed
- `docs/product/how-it-works/*`, only if architecture changed
- `AGENTS.md`: never edited directly. Propose changes in the PR description.
- A status comment on the issue
- A commit, and a PR (opened or updated, as draft if unfinished)

## Permissions

File writes in `docs/`, `git add/commit/push` to the work branch only, `gh issue comment`, `gh pr create/edit`.

## Steps

1. List what changed in this session: code, decisions, things tried and abandoned.
2. Update the spec. "Next steps" must be concrete enough for a stranger to start on.
3. For each decision someone might later ask "why?" about, run `decision-record`.
4. If user-visible behaviour changed, update the relevant feature file, including its availability table.
   Set `last_verified` to today on every product page you touched.
5. If plans changed, update `roadmap.md`. If an idea was dropped, add it to `ideas-rejected.md` with the reason.
6. If a convention or rule in `AGENTS.md` should change, write the proposal into the PR description under "Proposed AGENTS.md changes".
7. Run `python3 scripts/docs_check.py` and fix anything it reports for files you touched.
8. Commit with the issue reference, push the branch, and open or update the PR. Draft if unfinished.
9. Comment on the issue using the format below.

## Done when

- [ ] Spec Next steps are concrete
- [ ] Every product page touched has today's `last_verified`
- [ ] docs check passes for touched files
- [ ] Work is pushed and the PR is open or updated
- [ ] Issue has a status comment

## Output

Issue comment:

```
Status: <in progress | ready for review | blocked>
Done this session: <bullets>
Decisions: <links to decision records, or none>
Next step: <one concrete action>
Open questions: <bullets or none>
Spec: docs/specs/<file>  PR: #<n>
```
