---
title: Brew log
summary: Every finished brew is saved with its charts and numbers; rename or delete them.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - brew-log.js
  - scale-ui.js
---

# Brew log

## What it does

Every brew with readings is saved automatically when you press Stop. Settings, then Brew log, lists
them newest first with the date, dose and yield, and TDS. Opening one shows its charts and final
numbers, grouped as Brew, Extraction and EC meter. You can rename a brew or delete it (it asks
first).

## Who uses it

Anyone who wants to compare brews over time.

## Availability

| Condition | Available | Notes |
| --- | --- | --- |
| Chrome or Edge on Android | Yes | The main way it is used. |
| Chrome or Edge on Windows, macOS or Linux | Yes | Used with the real devices on a MacBook and a Windows mini PC. |
| iPad or iPhone, any normal browser (Safari, Chrome) | No | Apple doesn't allow Web Bluetooth in any iPad or iPhone browser. |
| iPad with the Bluefy browser | Yes | Tested on an iPad Pro 12.9", in landscape and portrait. |
| Firefox, Safari on a Mac | No | No Web Bluetooth. |
| Same browser on the same device | Yes | Brews are kept in that browser only, unless sync is on. |
| Other devices | Only with sync | See [Sync between devices](sync.md). |
| Brews older than the newest 100 | No | Each device keeps the newest 100. The sync server keeps them all. |

## Variants and edge cases

- A brew with only the scale shows the weight chart and weight numbers. Only the EC meter: the EC chart and EC numbers. Both: everything, including TDS vs extraction.
- The final TDS calculator and Trim update the saved brew.

## Limits and known gaps

- Clearing the browser's site data deletes the brews on that device (the app asks the browser to keep them, but can't force it).

## Related

- Decisions: [0004 Data in the browser](../../decisions/0004-data-stored-in-the-browser.md)
- How it works: [Saved data and sync](../how-it-works/saved-data-and-sync.md)
