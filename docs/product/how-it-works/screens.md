---
title: Screens and layout
summary: The page itself: the main screen, Settings, the sheets, and the phone and tablet layouts.
owner: Daniel Tse
last_verified: 2026-10-27
status: draft
standard_version: 1.0
code_paths:
  - index.html
  - style.css
  - scale-ui.js
  - manifest.webmanifest
---

# Screens and layout

## What it does

One page holds every screen: the main brewing screen, Settings, the final TDS calculator,
calibration, the brew log and sync. One script wires up every button and keeps the numbers up to
date. One stylesheet sets the look, from the phone layout up. The tablet layouts are switched on by
the stylesheet when the screen is big enough.

## How it connects to the rest

It uses every other part: the drivers for readings, the recorder and charts, the TDS maths, and the
saved data.

## Things that are easy to change

- Text, labels, colours (all colours are named in one place in the stylesheet), spacing and font sizes.
- The order of the readings.

## Things that are hard to change

- Big layout changes, because the phone and both tablet layouts must all keep working and fit without scrolling. They are checked by automated tests at several screen sizes.

## Related decisions

- [0001 Plain web app, no build step](../../decisions/0001-plain-web-app-no-build.md)
- [0002 Hosted on GitHub Pages](../../decisions/0002-hosted-on-github-pages.md)
