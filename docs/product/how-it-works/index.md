---
title: How it works
summary: How Brew Tool fits together, in plain English. Read this first, then only the subsystem files you need.
owner: Daniel Tse
last_verified: 2026-10-28
status: current
standard_version: 1.0
code_paths:
  - index.html
  - scale-ui.js
---

# How it works

## The big picture

Brew Tool is a single web page. Everything runs in your browser: it talks to the scale and the EC
meter over Bluetooth, records their readings while you brew, does the TDS maths, draws the charts,
and saves settings and brews in the browser's own storage. There's no app server. The only thing
outside the browser is the optional sync server, which copies settings and brews between the
owner's devices.

Readings flow like this: device → Bluetooth driver → the screen and the brew recorder → the charts
and TDS maths → at Stop, the brew log → (if sync is on) the sync server.

## Where things run

| Part | Runs on | Notes |
| --- | --- | --- |
| The app (page, scripts, styles) | GitHub Pages | Published straight from the main branch of the public repository. |
| Bluetooth, recording, maths, charts | The user's browser | Nothing is sent anywhere while brewing. |
| Settings and brew log | The user's browser | Kept per browser, per device. |
| Sync server (optional) | The owner's own server (a Linode, behind the owner's domain) | A separate private project, "brewlog-server". |
| These docs | GitHub Pages | Published with the app. |

## Where data lives

- Settings (bean dose, carafe, ratio, retained ratio, calibration and its history, which devices Start controls, remembered devices): the browser's local storage, until the site data is cleared.
- Brew log: the browser's database, newest 100 brews per device.
- With sync on: also on the sync server, which keeps every brew and makes a daily backup.
- The sync token: only in the browser of each device where it was typed in.

## What it depends on

- A browser with Web Bluetooth (Chrome or Edge on Android or desktop; Bluefy on iPad).
- A BOOKOO scale and/or a Belka PORTAL EC meter.
- GitHub Pages for hosting.
- Optional: the owner's sync server.

## Subsystems

| Subsystem | What it does | File |
| --- | --- | --- |
| Bluetooth devices | Finds, connects and talks to the scale and the EC meter | [bluetooth-devices.md](bluetooth-devices.md) |
| Recording and charts | Records every reading during a brew; draws the brew chart; download | [recording-and-charts.md](recording-and-charts.md) |
| TDS maths | Turns EC and weight into TDS and extraction; calibration | [tds-maths.md](tds-maths.md) |
| Saved data and sync | Settings, the brew log and syncing them | [saved-data-and-sync.md](saved-data-and-sync.md) |
| Screens and layout | The page, all the buttons and sheets, phone and tablet layouts | [screens.md](screens.md) |
