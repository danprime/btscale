---
title: Screens and install
summary: Phone and tablet layouts, and installing Brew Tool as an app.
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

# Screens and install

## What it does

On a phone the app fills the screen with the buttons at the bottom. On a big tablet it uses the
whole screen. In landscape, the numbers take the left third and the charts the right two thirds. In
portrait, the charts are on top and the numbers in the bottom third. On Android it can be installed
as an app called "Brew Tool", which opens in its own window.

## Who uses it

Everyone. The tablet layouts are for an iPad standing next to the brewer.

## Availability

| Condition | Available | Notes |
| --- | --- | --- |
| Chrome or Edge on Android | Yes | The main way it is used (tested on a Galaxy S24). |
| Chrome or Edge on Windows, macOS or Linux | Yes | Web Bluetooth works there. Open question: has it been used with the real devices on a desktop? |
| iPad or iPhone, any normal browser (Safari, Chrome) | No | Apple doesn't allow Web Bluetooth in any iPad or iPhone browser. |
| iPad with the Bluefy browser | Yes | Tested on an iPad Pro 12.9", in landscape and portrait. |
| Firefox, Safari on a Mac | No | No Web Bluetooth. |
| Phone | Yes | Checked at common phone sizes (Galaxy S24, iPhone SE size). |
| Tablet, landscape, at least 1024 × 700 | Tablet layout | Same layout for 11" and 12.9" iPads. |
| Tablet, portrait, at least 768 × 1000 | Tablet layout | Charts on top, numbers in the bottom third. |
| Smaller tablets and desktop windows | Card layout | The app shows as a floating card. |
| Install as an app | Android Chrome | Always opens in Chrome, which Web Bluetooth needs. |

## Variants and edge cases

- On a tablet, Settings slides in from the right, and the brew log shows the list beside the open brew.
- There's no offline copy: every launch loads the current version, so the app needs an internet connection to open.

## Limits and known gaps

- One language (English). Translating it was decided against for now (see [Ideas rejected](../ideas-rejected.md)).

## Related

- How it works: [Screens and layout](../how-it-works/screens.md)
