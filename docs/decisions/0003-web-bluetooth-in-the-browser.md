---
title: "0003: Talk to the devices with Web Bluetooth in the browser"
date: 2026-10-27
status: accepted
---

# 0003: Talk to the devices with Web Bluetooth in the browser

## Context

Recorded at bootstrap from existing code. The owner wanted bigger, easier-to-read numbers than the scale's own display and app, and knew Chrome could talk to Bluetooth devices.

## Decision

Use the browser's Web Bluetooth API to connect to the BOOKOO scale and the Belka PORTAL EC meter, with one Connect button for both and remembered devices reconnected via `getDevices()` where supported.

## Alternatives

- A native Android or iOS app: works on iPhone and iPad, but needs app stores and two code bases.
- The device makers' own apps: small numbers, one app per device, no combined TDS view.

## Consequences

Nothing to install, but only Chromium browsers (Android, desktop) and Bluefy on iPad work. No normal iPhone or iPad browser can be used. The EC meter's protocol was reverse-engineered and could change with firmware.

## Links

- `device-manager.js`, `bookoo-scale.js`, `belka-portal.js`
- `belka_portal_protocol.md`, `bookoo_protocols.md`
