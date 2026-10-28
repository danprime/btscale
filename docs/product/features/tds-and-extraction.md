---
title: Strength and extraction (TDS)
summary: Temperature, EC, live and final TDS, the TDS vs extraction chart, and calibrating the TDS estimate.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - tds.js
  - scale-ui.js
  - tds_calculations.md
---

# Strength and extraction (TDS)

## What it does

The EC meter measures how well the coffee coming out of the dripper conducts electricity (EC), and
its temperature. With the scale connected too, the app adds up EC against the water poured to
estimate how strong the cup will be (TDS, the percentage of dissolved coffee) and how much of the
coffee grounds ended up in the cup (extraction yield). A second chart plots strength against
extraction, with the "gold cup" zone shaded, and shows the brew's path as it goes.

After Stop, a calculator weighs the finished coffee to get the real yield and the final TDS. To make
the estimate match reality, you calibrate it once with a refractometer reading: the app works out a
correction number (called k_v) from that brew and remembers it, along with the last three.

## Who uses it

Brewers with both devices who want to know how strong their coffee is, and a refractometer for
calibrating.

## Availability

| Condition | Available | Notes |
| --- | --- | --- |
| Chrome or Edge on Android | Yes | The main way it is used. |
| Chrome or Edge on Windows, macOS or Linux | Yes | Used with the real devices on a MacBook and a Windows mini PC. |
| iPad or iPhone, any normal browser (Safari, Chrome) | No | Apple doesn't allow Web Bluetooth in any iPad or iPhone browser. |
| iPad with the Bluefy browser | Yes | Tested on an iPad Pro 12.9", in landscape and portrait. |
| Firefox, Safari on a Mac | No | No Web Bluetooth. |
| EC meter connected | Required | Temperature and EC need it. |
| Scale and EC meter both connected | Required for TDS and extraction | With only one of the two, none of the TDS features appear. |
| Bean dose set | Required for extraction | Extraction = yield × TDS ÷ bean dose. |
| Carafe weight set | Recommended | The calculator subtracts it to get the yield. |
| Calibrated (k_v saved at least once) | Recommended | Until then a rough default is used and every TDS value is marked "uncalibrated". |
| Retained ratio setting | Optional | How much water the coffee bed holds back (default 2 grams per gram of coffee). Used for the live yield estimate. |
| A refractometer | Required for calibration | The app doesn't measure TDS directly. |
| Brew water | Distilled assumed | Distilled water's own EC is about 0, so nothing is subtracted. Water with minerals would add to the EC. |

## Variants and edge cases

- The live TDS estimate starts 30 seconds after Start.
- Right after Stop the extraction dot is hollow (an estimate). After the calculator's Next it turns solid (measured).
- Tapping the extraction chart shows or hides the four region labels (Strong and sour, and so on).

## Limits and known gaps

- A calibration made with one bean and one pour technique can be off by about 0.1 % TDS for a different bean and technique. For now, 0.1 % is good enough. This is being explored in [#44](https://github.com/danprime/btscale/issues/44).
- Refractometer readings themselves can swing by up to 0.3 % TDS for the same sample at different temperatures, so a calibration is only as good as the reading it's based on.
- The calculations are written up in detail in the repository (TDS calculations document).

## Related

- Decisions: [0006 TDS from EC](../../decisions/0006-tds-from-cumulative-ec.md)
- Specs: [44 Better TDS calibration](../../specs/44-better-tds-calibration.md)
- How it works: [TDS maths](../how-it-works/tds-maths.md)
