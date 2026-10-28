---
title: "0001: A plain web app with no framework and no build step"
date: 2026-10-27
status: accepted
---

# 0001: A plain web app with no framework and no build step

## Context

Recorded at bootstrap from existing code. The app is a handful of JavaScript modules, one HTML page and one stylesheet, loaded directly by the browser.

## Decision

Vanilla JavaScript ES modules, plain HTML and CSS. No framework, no bundler, no transpiler. `package.json` only holds the test tools (Jest, Playwright).

## Alternatives

- A framework (React, Vue, Svelte): more structure, but a build step and dependencies for a small single-page app.
- A bundler: only needed once there are dependencies to bundle, and there are none at runtime.

## Consequences

What's in the repository is exactly what runs, so GitHub Pages can serve it as-is. All UI wiring sits in one large file (`scale-ui.js`), which is simple to follow but long.

## Links

- `index.html`, `scale-ui.js`, `package.json`
