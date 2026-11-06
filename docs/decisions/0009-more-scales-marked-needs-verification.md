---
title: "0009: Support more scale brands, and call each one unverified until tried on a real scale"
date: 2026-11-06
status: accepted
---

# 0009: Support more scale brands, and call each one unverified until tried on a real scale

## Context

Issue #50 asks for Acaia and other Bluetooth scales. The constraints said only two devices were supported. That line was about one scale (BOOKOO) and one EC meter (Belka PORTAL), not a limit on scale brands. The owner has no Acaia or other scale to test with.

## Decision

More scale brands are allowed, starting with Acaia, for any scale whose Bluetooth protocol is documented publicly. Only one EC meter stays supported, because no other Bluetooth EC meter is known. In the docs, every scale other than BOOKOO is marked "needs verification" until someone has tried it on a real scale.

## Alternatives

- Keep the app to BOOKOO only: simplest, but the issue asks for more users and other brands.
- Claim support from a protocol write-up alone: the owner cannot check it, and a wrong claim is worse than an honest "needs verification".

## Consequences

Each brand is its own driver, so the scale code has to be split by brand. Devices the browser remembers will need a brand stored next to them, with an upgrade path for data already on devices. Tests can only use a fake of each scale.

## Links

- Issue #50
- `docs/specs/50-acaia-and-other-scales.md`
- PR #53
