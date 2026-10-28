---
title: Decisions
summary: Plain-English index of the key decisions behind Brew Tool, linking to the full records.
owner: Daniel Tse
last_verified: 2026-10-28
status: current
standard_version: 1.0
---

# Decisions

Newest first. Full records live in the decisions folder.

| # | Decision | Why, in one line | Status |
| --- | --- | --- | --- |
| [0007](../decisions/0007-tests-with-fake-bluetooth.md) | Automated tests with a fake Bluetooth | Every feature can be tested without the real devices, in a real browser | accepted |
| [0006](../decisions/0006-tds-from-cumulative-ec.md) | Estimate TDS from EC added up over the water poured | The EC meter measures the coffee as it flows, so adding it up gives the strength of the cup | accepted |
| [0005](../decisions/0005-sync-through-own-server.md) | Sync through the owner's own small server, with one secret token | Simple, private, no accounts, and the server can keep every brew | accepted |
| [0004](../decisions/0004-data-stored-in-the-browser.md) | Keep settings and brews in the browser | No server needed to use the app; it works on each device on its own | accepted |
| [0003](../decisions/0003-web-bluetooth-in-the-browser.md) | Talk to the devices with Web Bluetooth in the browser | No app to install; Chrome can already talk to Bluetooth devices | accepted |
| [0002](../decisions/0002-hosted-on-github-pages.md) | Host on GitHub Pages, straight from the main branch | Free, nothing to run, and merging is the release | accepted |
| [0001](../decisions/0001-plain-web-app-no-build.md) | A plain web app with no framework and no build step | Small enough to stay simple; the files in the repository are exactly what runs | accepted |
