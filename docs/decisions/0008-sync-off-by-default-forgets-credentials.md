---
title: "0008: Sync is off by default, and switching it off forgets the server and token"
date: 2026-10-28
status: accepted
---

# 0008: Sync is off by default, and switching it off forgets the server and token

## Context

Sync needs a server address and a secret token. The first version showed both boxes all the time, with a separate "Turn off" button. The owner wanted a plain on/off switch, off for anyone who has not been given the values.

## Decision

Settings, then Sync, opens with a switch, "Sync data across all devices.", that is off by default. Switching it on shows the Server and Token boxes under "Check with Dan for values." Switching it off stops syncing and clears the saved address and token on that device. To sync again, both must be entered again. The device keeps its own settings and brews. If the switch is turned on but nothing is saved, it is off again the next time Sync is opened.

## Alternatives

- Keep the address and token while the switch is off: easier to turn back on, but a secret stays on a device that has stopped syncing.
- Keep the "Turn off" button and show the boxes all the time: nothing tells a new user that the values come from the owner, and sync looks like it is always meant to be set up.

## Consequences

A device that stops syncing no longer holds the token. Turning sync back on takes a few seconds of typing. The words "Check with Dan for values." are visible on the public site to anyone who opens Sync.

## Links

- PR #47
- `docs/product/features/sync.md`
