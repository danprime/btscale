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

## Links

- https://danprime.github.io/btscale/
- README: Install as an app
