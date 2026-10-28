---
title: Recording and charts
summary: Records every reading during a brew and draws the brew chart; makes the download file.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - brew-recorder.js
  - brew-chart.js
---

# Recording and charts

## What it does

From Start to Stop, the recorder keeps one row for every reading from either device, filled in with
the latest value from the other device. It supplies the brew chart, the final values, the trim, and
the downloaded spreadsheet file. The chart draws weight as the main line and EC as a thinner line,
each with its own scale, with time along the bottom.

## How it connects to the rest

It takes readings from the Bluetooth drivers. It feeds the screen, the TDS maths and, at Stop, the
brew log (which keeps up to 300 points per line).

## Things that are easy to change

- Chart colours, line widths, labels and axis ranges.
- How many points the brew log keeps per line.

## Things that are hard to change

- The columns of the download file, because spreadsheets made from earlier downloads expect them.

## Related decisions

- [0001 Plain web app](../../decisions/0001-plain-web-app-no-build.md)
