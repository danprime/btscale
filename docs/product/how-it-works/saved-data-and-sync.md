---
title: Saved data and sync
summary: Where settings and the brew log are kept, and how sync copies them between devices.
owner: Daniel Tse
last_verified: 2026-10-28
status: current
standard_version: 1.0
code_paths:
  - brew-log.js
  - sync.js
  - scale-ui.js
---

# Saved data and sync

## What it does

Settings are kept in the browser's local storage. Brews are kept in the browser's database, newest
100 per device. Sync, if set up, sends changed settings and brews to the owner's server and fetches
changes made on other devices. Every record carries the time it was last changed, and the newest
change wins.

## How it connects to the rest

The screens read and write settings. The brew log saves a brew at Stop and updates it after the
final TDS calculator or a trim. Any change asks sync to run shortly after.

## Things that are easy to change

- Which settings are synced.
- How long sync waits after a change before sending it.

## Things that are hard to change

- The stored formats: every device already holds data in them, so a change needs a careful upgrade.
- The sync format, because the server and every device must agree on it.

## Related decisions

- [0004 Data stored in the browser](../../decisions/0004-data-stored-in-the-browser.md)
- [0005 Sync through the owner's own server](../../decisions/0005-sync-through-own-server.md)
