---
title: Sync between devices
summary: Keeps settings and the brew log the same on a phone and a tablet, through the owner's own server.
owner: Daniel Tse
last_verified: 2026-10-28
status: current
standard_version: 1.0
code_paths:
  - sync.js
  - brew-log.js
  - scale-ui.js
---

# Sync between devices

## What it does

Settings, then Sync, connects the app to a small private server. Sync is off until you switch on
"Sync data across all devices." The server address and secret token then appear, under a note to
check with Dan for the values, and you enter them once per device. From then on, the bean dose, carafe weight, ratio, retained ratio,
calibration and brew log stay the same on every device. It syncs when the app opens or comes back to
the front, and shortly after a setting changes or a brew is saved, renamed or deleted.

## Who uses it

The owner. The server is the owner's own, and its token is private.

## Availability

| Condition | Available | Notes |
| --- | --- | --- |
| Chrome or Edge on Android | Yes | The main way it is used. |
| Chrome or Edge on Windows, macOS or Linux | Yes | Used with the real devices on a MacBook and a Windows mini PC. |
| iPad or iPhone, any normal browser (Safari, Chrome) | No | Apple doesn't allow Web Bluetooth in any iPad or iPhone browser. |
| iPad with the Bluefy browser | Yes | Tested on an iPad Pro 12.9", in landscape and portrait. |
| Firefox, Safari on a Mac | No | No Web Bluetooth. |
| Server address and token entered on this device | Required | Without them, everything stays on the device. |
| Online | Required to sync | Offline, it waits for the next chance. |
| The page's web address is one the server accepts | Required | The server only answers pages from addresses it knows. |

## Variants and edge cases

- For each setting and each brew, the newest change wins.
- A deleted brew is sent as a deletion, so it doesn't come back from another device.
- On a device's first sync, what the server already has wins over that device's own values.
- Switching sync off stops it on that device and forgets the server address and token. The device
  keeps its settings and brews. To sync again, switch it back on and enter both again.

## Limits and known gaps

- It doesn't sync while the app is closed or in the background.
- Sync for other people isn't decided yet. Someone who brews on several devices, like the owner, would probably want their own sync.

## Related

- Decisions: [0005 Own sync server](../../decisions/0005-sync-through-own-server.md)
- How it works: [Saved data and sync](../how-it-works/saved-data-and-sync.md)
