---
title: Constraints
summary: Hard limits, non-goals, and rules any change to Brew Tool must respect.
owner: Daniel Tse
last_verified: 2026-10-28
status: current
standard_version: 1.0
---

# Constraints

## Hard limits

- Bluetooth only works in browsers with Web Bluetooth: Chrome and Edge on Android, Windows, macOS and Linux. No browser on an iPhone or iPad has it (Apple doesn't allow it), so iPad use needs the Bluefy browser. Firefox and Safari don't have it.
- Bluetooth only works on secure (https) pages, and the device list can only open when you tap something, once per tap.
- Only two devices are supported: BOOKOO scales and the Belka PORTAL EC meter.
- TDS needs both devices at once, and calibrating it needs a refractometer.
- Everything is stored in the browser on each device. Clearing the browser's site data clears it, unless sync is on.
- Each device keeps the newest 100 brews.
- There's no offline copy of the app: opening it needs an internet connection. After a change is published, browsers can take up to about 10 minutes to pick it up.
- The app and these docs are hosted on GitHub Pages, which is public. Nothing private belongs in the app or the docs.
- Sync needs the owner's server. Its token must never be put in the code or docs.

## Non-goals

- Translations into other languages (English only for now).
- Hiding flow readings that look implausible.
- Progress or "remaining" cues while pouring. The target line on the chart is enough.
- Detecting individual pours automatically.
- Syncing while no brew is happening and the app is in the background.

## Rules

- Weight comes first on screen, then the elapsed time, ratio, temperature and EC, in that order of importance.
- The EC meter already corrects EC to 25 °C. Never correct it a second time.
- New colours use the named colours in the stylesheet. No new one-off colours.
- Every change keeps the phone layout fitting the screen without scrolling, at phone sizes like 384 × 720 and 375 × 667.
- Changes come with automated tests, which use a fake Bluetooth, and all tests pass before merging.
- Stored data formats change only with an upgrade path for data already saved on devices.

## Cost guide

Rough sizing so non-developers can judge ideas.

| Kind of change | Typical size |
| --- | --- |
| Text, labels, colours, layout tweaks | Hours |
| A new reading or card from data the app already has | Hours to a day |
| New screen or view using existing data (e.g. a new brew log view) | Days |
| Changes to the TDS maths or calibration | Days, plus test brews with a refractometer |
| A new scale or other Bluetooth device | Weeks: needs the device in hand and a new driver |
| Anything changing the stored data or sync format | Needs discussion: devices and the server already hold data |
