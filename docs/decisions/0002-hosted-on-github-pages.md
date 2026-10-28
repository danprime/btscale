---
title: "0002: Host on GitHub Pages, straight from the main branch"
date: 2026-10-27
status: accepted
---

# 0002: Host on GitHub Pages, straight from the main branch

## Context

Recorded at bootstrap from existing code. GitHub Pages is set to the legacy "deploy from a branch" mode: `main`, root folder, with Jekyll. There is no deploy workflow and no service worker.

## Decision

Publish the app from `main` on GitHub Pages. Merging a PR to `main` is the release. The `docs/` folder is published with it.

## Alternatives

- A deploy workflow (Pages from GitHub Actions): more control, e.g. a nicer docs site, but more to maintain.
- Own hosting: more to run, no benefit for a static app.
- A service worker for offline use: faster starts, but users could keep running an old version.

## Consequences

No servers or build to maintain. The repository and the site are public. Browsers may cache files for up to about 10 minutes after a release.

The owner chose (2026-10-28) to keep the docs in `docs/`, published by the same Jekyll build, rather than add a separate docs workflow. Jekyll reads Liquid template tags in published Markdown and HTML, and one stray tag can fail the build and stop app updates too. So `scripts/check_jekyll.py` checks for them, `_config.yml` excludes the decision template, and the `docs-check` workflow runs GitHub's own Pages builder.

## Links

- https://danprime.github.io/btscale/
- README: Install as an app
