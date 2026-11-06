---
title: Predict k_v by dragging the final TDS
issue: "#48"
owner: Daniel Tse
last_verified: 2026-10-30
status: draft
---

# Predict k_v by dragging the final TDS

## Goal

After a brew, the owner can drag the final TDS dot on the TDS vs extraction chart to where they think
it should be and read the k_v that would put it there, next to the k_v in use. Nothing is saved or
recalculated.

## Users

The owner, while working out how far off the calibrated k_v is (see #44).

## Decisions

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Where it works | Only on the final screen, after the calculator's Next (final TDS measured) | The brew log charts: asked for the final screen only. The live path while brewing: there's no final yield yet |
| What can change | TDS only; the yield stays as measured | Dragging the yield too: the yield is weighed, not guessed |
| How the dot moves | Along a slanted line, because extraction = yield × TDS ÷ dose moves with TDS | Straight up and down: extraction would no longer match the TDS shown |
| What happens when you let go | The dot stays where you put it, so you can read the numbers | Snapping back: you couldn't look at the result |
| When the dragged dot goes away | When a new brew starts, or the calculator is run again | Keeping it across brews: it belongs to this brew's numbers. Keeping it after a new yield: the predicted k_v depends on the yield, so it would be wrong |
| Which dot moves | A second "what if" dot; the real final dot stays visible | Moving the final dot itself: you lose the measured point to compare against |
| What the predicted k_v does | Shown only, to copy by hand if wanted | A "use this k_v" button: a second way to change k_v, outside the calibration history (#44) |
| Effect on the real result | None: final TDS, extraction, stored k_v and the brew log entry stay the same | |
| Where the readout goes | A card of its own right under the chart, shown only after a drag: "If TDS were 1.48 % · k_v 0.005441 · now 0.005", dashed to mark it as a "what if" | A reading next to TDS in the readings grid: looks like a measured value and pushes the grid onto another row, so the screen scrolls on a 375×667 phone |
| Where the drag starts | Only by pressing on (or near) the final dot | The whole chart: it would break swiping between charts, scrolling the page and the tap that shows the region labels |

## Acceptance criteria

- [ ] Given a stopped brew with both devices and a final TDS from the calculator, when the owner presses the final dot and drags it up, then the dot moves up and to the right along the yield's line, and a readout shows the dragged TDS, the predicted k_v and the current k_v.
- [ ] Given a dragged dot, when the owner lets go, then the dot and the readout stay where they are, and the real final dot is still shown.
- [ ] Given a dragged dot, when a new brew starts, then the dragged dot and the readout are gone.
- [ ] Given a dragged dot, when the calculator's Next is pressed again, then the dragged dot and the readout are gone.
- [ ] Given a dragged dot, then the final TDS on the TDS card, the extraction value, the k_v in Settings and the saved brew in the brew log are unchanged.
- [ ] Given the predicted k_v, when worked out by hand as dragged TDS × yield ÷ (100 × added-up EC), then it matches the readout to 4 significant digits.
- [ ] Given the final screen, when the owner taps the chart away from the dot, then the region labels still toggle, and swiping sideways still moves between the charts.
- [ ] Given the calculator hasn't been used yet (hollow, estimated dot), when the owner presses the dot, then nothing drags.
- [ ] Given a brew opened in the brew log, then its chart can't be dragged.
- [ ] Given k_v is uncalibrated, then the readout shows the current k_v as the default, marked "uncalibrated".

## Test cases

| Case | Steps | Expected |
| --- | --- | --- |
| Happy path | Mocked brew with both devices, Stop, calculator Next, drag the dot up | Readout shows a higher TDS and a higher predicted k_v; current k_v unchanged |
| Drag down | Same, drag down | Lower TDS and lower predicted k_v |
| Let go | Drag, then release | Dot and readout stay |
| Calculator again | Drag, open Final TDS, change the yield, Next | Dragged dot and readout gone; real dot at the new TDS |
| New brew | Drag, Reset, Start | Dragged dot and readout gone |
| Nothing saved | Drag, then open Settings and the brew log | Settings k_v and the logged TDS are the same as before the drag |
| Tap still works | Tap the chart away from the dot | Region labels toggle; dot doesn't move |
| Swipe still works (phone) | Swipe sideways starting away from the dot | Moves to the brew chart |
| Before Next | Stop, don't use the calculator, press the dot | No drag, no readout |
| Uncalibrated | No saved k_v, drag | Current k_v shown as default, marked uncalibrated |
| Off the chart | Drag beyond the top or bottom of the chart | TDS limited to the chart's TDS range; readout matches the dot |
| Scale only or EC meter only | Brew with one device | No extraction chart, so nothing to drag (as today) |
| Phone sizes | 384×720 and 375×667 | Readout fits and doesn't cover the dot |
| Tablet | Landscape and portrait | Drag works where both charts are shown together |

## Status

- Done: feasibility review on #48 (feasible, Small to Medium); mockups of two readout placements, card under the chart chosen.
- Next steps: add a dragging hit area around the final dot in `drawExtractionChart` (final screen only) and draw the dashed "what if" dot and its line; work out k_v with `calcKv()` from `tds.js`; add the card under the chart; clear both when a new brew starts or the calculator's Next is pressed; write a Playwright spec with the mocked devices.

## Open questions

- None.
- Copying the predicted k_v into the app today means Settings → Calibrate → typing it in step 2's "New" box. Saving any k_v there marks it calibrated, not uncalibrated, and adds it to the last-3 list. Is that fine for a "what if" value, or is a plain k_v field in Settings wanted (a separate issue)?
