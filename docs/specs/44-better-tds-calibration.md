---
title: Better TDS calibration
issue: "#44"
owner: Daniel Tse
last_verified: 2026-10-27
status: in progress
---

# Better TDS calibration

## Goal

The app's TDS stays close to a refractometer reading across different beans and pour techniques,
without recalibrating every time.

## Users

The owner, brewing with the scale, the EC meter and a refractometer.

## Decisions

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Record calibrations per brew first | Yes: each calibration is stored on the brew it used (refractometer TDS, app error, k_v from the brew, saved or kept) | Guessing the cause without data: two things changed at once |
| How to fix the drift | Not decided | k_v per recipe or bean; weighting CIY differently; weighing only the carafe (loses the poured-water reading the targets use) |

## Acceptance criteria

- [ ] Given a brew used for calibration, when it is opened in the brew log, then it shows the refractometer TDS, the app's TDS for the same yield, the difference, the k_v from that brew and whether it was saved.
- [ ] Given a calibrated recipe, when a different bean or pour technique is brewed, then the app's TDS is within an agreed margin of the refractometer. Open question: what margin is good enough (for example 0.03 % TDS)?

## Test cases

| Case | Steps | Expected |
| --- | --- | --- |
| Same bean, same technique | Calibrate on a 3-pour brew, brew it again | App TDS close to the refractometer (seen: consistent over 3 brews) |
| Different bean, different technique | 5-pour brew with another bean, same k_v | Seen: about 0.1 % TDS off |
| Different bean, same technique | New bean with the calibrated 3-pour recipe | Not yet tried: tells whether the bean or the pour pattern is the cause |

## Status

- Done: the per-brew calibration record is built and tested on branch `log-calibration` (not merged).
- Next steps: merge `log-calibration`; brew the new bean with the calibrated 3-pour recipe and calibrate it; compare the recorded app errors; then choose a fix.

## Open questions

- Is the drift mostly from the pour pattern (CIY only counts EC while water is poured, because everything sits on the scale) or from the bean?
- Would a k_v per recipe or bean be acceptable to pick before each brew?
- Does the brew water's own EC matter enough to subtract it?
- What margin of error is good enough?
