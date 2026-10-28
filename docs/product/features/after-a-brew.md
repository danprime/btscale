---
title: After a brew
summary: Final values after Stop, trimming a late Stop, and downloading the readings.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - scale-ui.js
  - brew-recorder.js
  - brew-chart.js
---

# After a brew

## What it does

When you press Stop, the screen freezes on the brew's final values: weight, time, ratio, average
flow, temperature at stop and peak EC. A slim line under the chart still shows live readings, so you
can weigh the cup. If you pressed Stop late, a small Trim button lets you drag an end line back to
where the brew really ended; the numbers, charts, TDS and the saved brew follow it. A download
button saves every reading as a spreadsheet file (CSV). Reset goes back to live.

## Who uses it

Anyone who has just finished a brew.

## Availability

| Condition | Available | Notes |
| --- | --- | --- |
| Chrome or Edge on Android | Yes | The main way it is used. |
| Chrome or Edge on Windows, macOS or Linux | Yes | Used with the real devices on a MacBook and a Windows mini PC. |
| iPad or iPhone, any normal browser (Safari, Chrome) | No | Apple doesn't allow Web Bluetooth in any iPad or iPhone browser. |
| iPad with the Bluefy browser | Yes | Tested on an iPad Pro 12.9", in landscape and portrait. |
| Firefox, Safari on a Mac | No | No Web Bluetooth. |
| A brew was recorded (Start, then Stop) | Required | Nothing appears if no readings came in. |
| Trim | Optional, after Stop | It suggests the moment the weight dropped (dripper lifted), if it did. Not yet tried on a real brew. |
| Final TDS calculator | Scale and EC meter both used | See [Strength and extraction](tds-and-extraction.md). |

## Variants and edge cases

- A trim can be changed or undone ("Keep all") until the next Start.
- If the devices disconnect after Stop, the brew stays on screen, Connect appears under the chart, and Reset still works.

## Limits and known gaps

- The downloaded file has one row per reading from either device, with the latest value from the other device filled in.

## Related

- Other features: [Brew log](brew-log.md), [Live brewing](live-brewing.md)
- How it works: [Recording and charts](../how-it-works/recording-and-charts.md)
