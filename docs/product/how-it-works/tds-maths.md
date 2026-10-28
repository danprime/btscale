---
title: TDS maths
summary: Turns EC and weight into TDS and extraction yield, and works out the calibration number.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - tds.js
  - tds_calculations.md
---

# TDS maths

## What it does

Each time the EC meter sends a reading, the app multiplies the EC by the water poured since the
last reading and adds it to a running total (called the Cumulative Ionic Yield, or CIY). TDS is that
total times a calibration number (k_v), divided by the yield. Extraction yield is the yield times
TDS divided by the bean dose. Calibration turns it around: given a refractometer TDS and the weighed
yield, it works out k_v.

## How it connects to the rest

It takes EC readings and the scale's weight while brewing. It feeds the TDS card, the TDS vs
extraction chart, the final TDS calculator, calibration and the brew log. The EC meter already
corrects EC to 25 °C, so the app uses it as it arrives.

## Things that are easy to change

- The default calibration number, the default retained ratio, the axis ranges and the gold cup zone.

## Things that are hard to change

- The method itself: earlier brews and calibrations were made with it, so a change makes old and new numbers hard to compare.
- Because the scale weighs everything (dripper, EC meter and carafe), weight only rises while you pour. So the total only counts EC readings taken during pours, and different pour patterns can give different results ([#44](https://github.com/danprime/btscale/issues/44)).

## Related decisions

- [0006 TDS from cumulative EC](../../decisions/0006-tds-from-cumulative-ec.md)
