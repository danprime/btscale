---
title: Bluetooth devices
summary: Finds, connects and talks to the BOOKOO scale and the Belka PORTAL EC meter.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - ble-scale.js
  - bookoo-scale.js
  - belka-portal.js
  - device-manager.js
  - ble-mock.js
  - emitter.js
  - scale-utils.js
---

# Bluetooth devices

## What it does

Each device has its own driver. The scale driver understands the BOOKOO scale's messages (weight,
flow, battery, timer) and sends it commands like tare and start timer. The EC meter driver reads the
Belka PORTAL's stream (EC, temperature, battery) and can start and stop its timer and beep. A device
manager sits above both: it runs the single Connect button, remembers devices you've used, and
reconnects them.

## How it connects to the rest

Readings go to the screen and to the brew recorder. Commands come from the main buttons (Start,
Stop, Tare). In tests, a fake Bluetooth stands in for the real devices, so every feature can be tested
without hardware.

## Things that are easy to change

- Which devices Start and Stop control, and the scale's beep and auto-off settings.
- Wording of connection messages.

## Things that are hard to change

- Supporting another scale: each brand speaks its own Bluetooth language, so it needs a new driver and testing with the real scale.
- The EC meter's protocol was worked out from the Belka app, not from published documents. A firmware update could change it.

## Related decisions

- [0003 Web Bluetooth in the browser](../../decisions/0003-web-bluetooth-in-the-browser.md)
