---
title: "0007: Automated tests with a fake Bluetooth"
date: 2026-10-27
status: accepted
---

# 0007: Automated tests with a fake Bluetooth

## Context

Recorded at bootstrap from existing code. Every feature depends on Bluetooth devices, which CI and most test runs don't have.

## Decision

Playwright tests in Chromium, with a mock `navigator.bluetooth` (`ble-mock.js`) that plays the scale and the EC meter; Jest for small pure functions. CI runs both on pushes to `main` only, since PRs are merged straight away.

## Alternatives

- Manual testing with the real devices only: slow, and easy to miss regressions in the layouts.
- Running CI on every PR as well: a second identical run, as PRs are merged immediately.

## Consequences

Changes can be checked at phone and tablet sizes without hardware. Real-device behaviour (timing, firmware quirks) still needs a real brew. Linux fonts in CI differ from Windows, so layout tests can fail only in CI.

## Links

- `tests/`, `ble-mock.js`, `.github/workflows/playwright.yml`
- PR #26
