---
title: Docs bootstrap
summary: Adopt the agent-ready standard in an existing repo by drafting AGENTS.md and product docs from what already exists.
owner: Daniel Tse
last_verified: 2026-10-27
status: current
standard_version: 1.0
---

# Docs bootstrap

## Purpose

Get an existing repo to the standard in one PR, with docs drafted from the real code rather than written from scratch.

## When to use / when not to

- Use once per repo, when adopting the standard.
- Re-run only when a repo has drifted so far that `docs-drift-check` can't reasonably fix it.

## Inputs

- Path to the agent kit (the `agent-standards` repo) containing `template/`.
- Optional notes from the owner about the project.

## Reads

- The whole repo: README, package/manifest files, source tree, existing workflows, existing docs
- Open and recently closed issues and PRs (`gh issue list --state all --limit 50`, `gh pr list --state all --limit 30`)
- Git history (`git log --oneline -50`)

## Writes

- Everything in `template/`, merged into the repo without overwriting existing files
- Filled-in `AGENTS.md`, `docs/product/*`, `.devcontainer/devcontainer.json`
- One PR on branch `docs/agent-ready`

## Permissions

File writes in the repo, `git` on the bootstrap branch, `gh` read commands, `gh pr create`.

## Steps

1. Create branch `docs/agent-ready`.
2. Copy `template/` into the repo. For any file that already exists, merge rather than overwrite:
   append the template's lines to `.gitignore`, add to existing workflows instead of replacing them.
3. Fill the double-brace owner and date placeholders in every file header with the owner and today's date. Leave the `_template.md` and `0000-template.md` files untouched.
4. Fill `AGENTS.md` from the real build, run, test and lint commands. Run each command to confirm it works. If one doesn't exist (e.g. no tests), say so explicitly.
5. Draft every page in `docs/product/` from the code and history, in plain English. Set `status: draft`.
6. Features: list every user-facing capability. If there is more than one distinct area, create one file per area from `features/_template.md` and list them in `features/index.md`. Every feature file gets an availability table and `code_paths`.
7. How it works: same pattern. One `index.md`, plus one file per subsystem if the system has more than one.
8. Write anything you could not determine from the repo as an "Open question:" line on the relevant page. Never guess facts about users, plans or constraints.
9. Capture in-flight work: for each open issue or unmerged branch with real work, add it to `roadmap.md`, and create a spec stub if the work is non-trivial.
10. Record decisions that are visible in the code (framework, hosting, storage) with `decision-record`. Mark their context as "Recorded at bootstrap from existing code".
11. Adjust `.devcontainer/devcontainer.json` to the project's actual stack.
12. Wire the docs site into CI (see `docs-site.yml` notes). If the repo already deploys a site, integrate with that deploy rather than replacing it.
13. Run `python3 scripts/docs_check.py` and `python3 scripts/build_docs_site.py`. Fix errors.
14. Open the PR. The description lists: what was added, every Open question, anything merged into existing files, and anything that needs the owner's decision.

## Done when

- [ ] Every command in `AGENTS.md` was run and works, or is marked as not existing
- [ ] Every product page exists, has a valid header, and is `status: draft`
- [ ] Every Open question is listed in the PR description
- [ ] docs check passes and the site builds
- [ ] No existing file was overwritten without being merged

## Output

A PR titled `Adopt agent-ready standard`, with the open questions listed for the owner.
