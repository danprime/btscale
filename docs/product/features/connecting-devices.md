---
title: Connecting devices
summary: One Connect button for the scale and the EC meter, with known devices reconnected automatically.
owner: Daniel Tse
last_verified: 2026-10-28
status: current
standard_version: 1.0
code_paths:
  - device-manager.js
  - ble-scale.js
  - bookoo-scale.js
  - belka-portal.js
---

# Connecting devices

## What it does

One Connect button connects the BOOKOO scale and the Belka PORTAL EC meter. The first time, the
browser shows a list of nearby devices for you to pick from. Browsers only allow one list per tap,
so with two devices you tap Connect twice. After that, devices you've used before are reconnected
without the list, where the browser allows it. Two small icons in the header show each device: faded
means not connected (tap it to connect), solid means connected.

## Who uses it

Everyone, at the start of every brew session.

## Availability

| Condition | Available | Notes |
| --- | --- | --- |
| Chrome or Edge on Android | Yes | The main way it is used. |
| Chrome or Edge on Windows, macOS or Linux | Yes | Used with the real devices on a MacBook and a Windows mini PC. |
| iPad or iPhone, any normal browser (Safari, Chrome) | No | Apple doesn't allow Web Bluetooth in any iPad or iPhone browser. |
| iPad with the Bluefy browser | Yes | Tested on an iPad Pro 12.9", in landscape and portrait. |
| Firefox, Safari on a Mac | No | No Web Bluetooth. |
| BOOKOO Mini scale | Yes | Used regularly. Other BOOKOO scales that use the same Bluetooth service may work, but haven't been tried. |
| Belka PORTAL EC meter | Yes | Its Bluetooth protocol was worked out from the Belka app. |
| Any other scale (Acaia, Felicita, Timemore, ...) | No | See the [Roadmap](../roadmap.md): "Support for other scales as needed". |
| Reconnecting without the device list | Limited | Only in browsers that can list devices you've already allowed. If a remembered device doesn't answer within 8 seconds, it is forgotten and the list is shown next time. |
| Web page opened over https (or on the developer's own computer) | Required | Browsers only allow Bluetooth on secure pages. |

## Variants and edge cases

- With both devices connected, Connect becomes "Disconnect (both)". With only one, there's a separate Disconnect button.
- If the devices disconnect after Stop, the finished brew stays on screen and Reset still works.
- Error messages only appear for connection problems.

## Limits and known gaps

- One tap can only open one device list, so the first connection of two devices takes two taps.

## Related

- Decisions: [0003 Web Bluetooth](../../decisions/0003-web-bluetooth-in-the-browser.md)
- How it works: [Bluetooth devices](../how-it-works/bluetooth-devices.md)
