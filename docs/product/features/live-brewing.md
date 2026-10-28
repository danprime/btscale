---
title: Live brewing
summary: Big weight, time and ratio while you pour, with flow, target and a live chart.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - scale-ui.js
  - brew-chart.js
  - bookoo-scale.js
  - index.html
  - style.css
---

# Live brewing

## What it does

The weight is the biggest thing on the screen, with the time and the brew ratio under it. Below
that are smaller readings: flow (grams per second), the target ("20g in → 300g out") and how much is
left to pour. A chart draws the weight as you pour, with the target as a dashed line. Start, Stop
and Reset are one big button in the middle, with Tare on one side and a button that stores the bean
dose from the scale on the other.

## Who uses it

Anyone brewing pour-over with a BOOKOO scale.

## Availability

| Condition | Available | Notes |
| --- | --- | --- |
| Chrome or Edge on Android | Yes | The main way it is used. |
| Chrome or Edge on Windows, macOS or Linux | Yes | Web Bluetooth works there. Open question: has it been used with the real devices on a desktop? |
| iPad or iPhone, any normal browser (Safari, Chrome) | No | Apple doesn't allow Web Bluetooth in any iPad or iPhone browser. |
| iPad with the Bluefy browser | Yes | Tested on an iPad Pro 12.9", in landscape and portrait. |
| Firefox, Safari on a Mac | No | No Web Bluetooth. |
| BOOKOO scale connected | Required | Weight, flow, ratio and the target need the scale. |
| Only the EC meter connected | Limited | The chart shows EC instead of weight, and the time comes from the app's own clock. |
| Bean dose set (in Settings, or stored from the scale) | Required for ratio and target | Target = bean dose × ratio. Without a dose the target shows "--". |
| Ratio setting | Optional | Default 1:15. Can be anything above 0 up to 1:30, with decimals. |
| Which devices Start and Stop control | Per device | Start and Stop can also start the scale's timer and the EC meter's timer and beep. This setting is currently hidden in Settings, but a saved choice still applies. |

## Variants and edge cases

- The time comes from the scale's timer when the scale is connected and controlled by Start, otherwise from the app's own clock.
- The target is always bean dose × ratio. It updates as soon as either changes and isn't cleared if the scale disconnects.
- With nothing connected, the empty chart shows a Connect button and the main buttons are greyed out.
- The chart always covers the whole brew from Start to now (at least 30 seconds wide).

## Limits and known gaps

- Only BOOKOO scales are supported (see [Constraints](../constraints.md)).
- There are no progress or "remaining" cues beyond the target line on the chart. That was a deliberate choice (see [Ideas rejected](../ideas-rejected.md)).

## Related

- Decisions: [0001 Plain web app](../../decisions/0001-plain-web-app-no-build.md), [0003 Web Bluetooth](../../decisions/0003-web-bluetooth-in-the-browser.md)
- Other features: [Connecting devices](connecting-devices.md), [After a brew](after-a-brew.md)
