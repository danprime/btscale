---
title: "0004: Keep settings and brews in the browser"
date: 2026-10-27
status: accepted
---

# 0004: Keep settings and brews in the browser

## Context

Recorded at bootstrap from existing code. Settings are in localStorage (keys ending in `V1`); the brew log is in IndexedDB (`btscaleBrewLogV1`), newest 100 brews.

## Decision

Store everything on the device, in the browser. No accounts, and no server is needed to use the app.

## Alternatives

- A server-side database with accounts: shared across devices, but a service to run and secure for one user.

## Consequences

Works offline once loaded and on each device on its own. Data is lost if site data is cleared, and devices don't share data unless sync is set up (0005). Stored formats are versioned (`V1`) so they can be migrated.

## Links

- `brew-log.js`, `scale-ui.js`
