---
title: Documentation
summary: Home of the Brew Tool documentation, with one section for people who use the app and others for people who work on it.
owner: Daniel Tse
last_verified: 2026-10-28
status: current
standard_version: 1.0
---

# Brew Tool documentation

Brew Tool is a web app for brewing pour-over coffee with a Bluetooth scale and, optionally, a
Bluetooth EC meter. The app itself runs at [myscale.danieltse.com](https://myscale.danieltse.com/).

## For people who use the app

**[Product docs](product/index.md)**: plain-English pages on what Brew Tool is, what it can do and
how it works. Start with [the brief](product/brief.md).

## For people who work on the app

| Section | What's in it |
| --- | --- |
| [Decision records](https://github.com/danprime/btscale/tree/main/docs/decisions) | One short record per significant decision: the context, the choice, and what else was considered. The [decisions summary](product/decisions.md) lists them in plain English. |
| [Specs](https://github.com/danprime/btscale/tree/main/docs/specs) | One file per piece of work in progress, named after its GitHub issue. |
| [Runbooks](https://github.com/danprime/btscale/tree/main/docs/runbooks) | Step-by-step procedures for routine jobs, used by contributors and AI assistants. |
| [Incidents](https://github.com/danprime/btscale/tree/main/docs/incidents) | Logs of anything that broke in production, and what was learned. None so far. |
| [README](https://github.com/danprime/btscale#readme) | Developer reference: modules, screens, TDS behaviour, CSV format. |
| [AGENTS.md](https://github.com/danprime/btscale/blob/main/AGENTS.md) | How to build, test and change the code, and the rules for AI assistants. |

## For AI assistants

[llms.txt](https://myscale.danieltse.com/llms.txt) at the site root lists the product pages with a
one-line summary each, linking their Markdown source.
