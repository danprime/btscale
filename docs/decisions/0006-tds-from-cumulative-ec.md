---
title: "0006: Estimate TDS from EC added up over the water poured"
date: 2026-10-27
status: accepted
---

# 0006: Estimate TDS from EC added up over the water poured

## Context

Recorded at bootstrap from existing code. The Belka PORTAL measures EC of the coffee as it leaves the dripper. The device already corrects EC to 25 °C.

## Decision

Cumulative Ionic Yield: add EC × grams poured since the last reading, measured against the highest weight so far. TDS % = 100 × k_v × CIY / yield. k_v is calibrated from a refractometer reading (default 0.005, marked uncalibrated). EC is used as it arrives, with no second temperature correction.

## Alternatives

- Use the latest EC reading alone: only reflects the current drip, not the whole cup.
- Correct EC for temperature again in the app: the device already does it.

## Consequences

Live and final TDS without a refractometer after calibration. The total only counts EC while the weight rises, so pour pattern and bean can shift the result (#44). All maths is written up in `tds_calculations.md`.

## Links

- `tds.js`, `tds_calculations.md`
- PR #19, PR #23
- Issue #44
