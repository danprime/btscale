---
title: Acaia and other Bluetooth scales
issue: "#50"
owner: Daniel Tse
last_verified: 2026-11-06
status: draft
---

# Acaia and other Bluetooth scales

## Goal

Someone with an Acaia scale (and later other brands) can connect it with the same Connect button and brew exactly as they would with a BOOKOO scale.

## Users

Coffee brewers who own an Acaia scale and not a BOOKOO. The issue's reason is "more compatibility equals more users". Who exactly these users are is not stated in the issue (see Open questions).

## Decisions

Only what the issue says is decided. Everything else is under Open questions.

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| First scale brand | Acaia | None recorded. The issue says "namely acaia" |
| Which scales | Any Bluetooth scale whose protocol is documented somewhere public, Acaia first, newer and older Acaia models both aimed for | A single brand only: the issue says "any standard BLE scale" |
| How compatibility is shown in the docs | Every scale other than BOOKOO is listed as "needs verification" until someone has tried it on a real scale | Claiming support from a protocol write-up alone: nobody on the project owns the scales |
| The "only two devices" constraint (see [decision 0009](../decisions/0009-more-scales-marked-needs-verification.md)) | It was about one scale (BOOKOO) and one EC meter (Belka PORTAL). More scales are allowed. There is still only one supported EC meter, because no other Bluetooth EC meter is known | Keeping "only two devices": it would block this issue |
| Where the new scale appears | In the existing scale slot: Connect still offers one scale and one EC meter | Not decided whether two scales at once is ever wanted |
| Fix for the stale line in `belka_portal_protocol.md` (it says Acaia, DiFluid and Felicita drivers are in the app; only BOOKOO is) | Corrected as part of this work | Fixing it on its own now: it becomes true or gets removed depending on what this work delivers |

## What the code looks like today (for whoever builds it)

- `ble-scale.js` is hard-wired to the BOOKOO service (`0x0FFE`) and its two characteristics.
- `bookoo-scale.js` holds both the BOOKOO commands (tare, timer, beep and so on) and the use of `scale-utils.js` to read weight packets. It emits `data` with the weight, time, flow and battery.
- `device-manager.js` asks the browser for a scale by that one service, and `deviceTypeOf` treats anything that is not the Portal as a scale.
- Tests use a fake Bluetooth (`ble-mock.js`) that only imitates the BOOKOO scale and the Portal.
- A driver for another brand would have to give the rest of the app the same things: connect, disconnect, tare, start, stop and reset the timer, and a stream of readings. Whether every brand can do all of these is open.

## Acceptance criteria

These hold for the first new scale, once it is chosen. Items marked (open) depend on the questions below.

- [ ] Given an Acaia scale that is on and in range, when the person presses Connect, then it appears in the device list and connects.
- [ ] Given a connected Acaia scale, when weight is added, then the weight on screen updates live, in grams.
- [ ] Given a connected Acaia scale, when the person presses Start, pours and presses Stop, then the brew is recorded and appears in the brew log like a BOOKOO brew.
- [ ] Given a connected Acaia scale, when the person presses Tare, then the weight returns to zero. (open: whether the scale or the app does it)
- [ ] Given an Acaia scale, when it disconnects or is switched off during a brew, then the app behaves as it does for a BOOKOO scale (the finished brew stays on screen and Reset still works).
- [ ] Given a BOOKOO scale and a Portal, when they connect, then everything works exactly as before.
- [ ] Given a device remembered from an earlier visit, when the page opens, then each device reconnects to its own kind of driver, with no picker.
- [ ] Given a brew from a device brand other than BOOKOO, when sync is on, then it syncs and displays like any other brew, and no stored or synced data format changes without an upgrade path.
- [ ] The phone layout still fits without scrolling at 384 x 720 and 375 x 667.
- [ ] `belka_portal_protocol.md` and `docs/product/features/connecting-devices.md` say which scales are supported, with "needs verification" beside every scale that is not BOOKOO, and the stale line is gone.

## Test cases

| Case | Steps | Expected |
| --- | --- | --- |
| Happy path, fake Acaia | Install a fake Acaia in the test Bluetooth, press Connect, send weight packets | Weight shown; brew recorded and saved |
| Happy path, real Acaia | Same, with a real scale | Same. Needs the scale in hand (see Open questions) |
| BOOKOO unchanged | Run the existing scale, weight, trim, tds and connect specs | All still pass |
| Both brands nearby | Press Connect with a BOOKOO and an Acaia both on | Picker offers both; the one chosen is the one used |
| Remembered device | Connect an Acaia, reload | Reconnects without the picker, to the Acaia driver |
| Unsupported unit | Put the Acaia in ounces | Open: convert, or tell the person (the BOOKOO only supports grams) |
| Chrome, no Web Bluetooth | Open in Firefox | No change from today |
| Dropped link | Switch the Acaia off mid-brew | Same as BOOKOO |
| Unknown scale brand | Choose a scale with a service the app has no driver for | Open: how it is excluded or reported |

## Status

- Done: driver for older Acaia scales (service 0x1820, ISC-licensed protocol from bpowers/btscale) in `acaia-protocol.js` and `acaia-scale.js`. `scale-switch.js` picks the driver by device name (ACAIA, PEARL, LUNAR, PYXIS or PROCH prefix; anything else is BOOKOO), so no stored format changed. Fake Acaia in `ble-mock.js` and `tests/acaia.spec.js`. Merged in #55 and #56; the full Playwright suite passes in CI. Not tried on a real scale, so it is "needs verification" in the docs. The stale line in `belka_portal_protocol.md` is fixed.
- Next steps:
  1. Check at 384 x 720 and 375 x 667 that the settings row ("Acaia (needs verification)") fits. CI's layout tests pass, but nobody has looked at it.
  2. Find someone with an older Acaia (Lunar or Pearl from about 2016) to try it. Check the device name prefixes, that weight and Tare work, and whether the timer commands (start 5, stop 7) behave. Then change the docs from "Needs verification" for that model.
  3. For newer Acaia models (Lunar 2021, Pearl firmware 2.0, Pyxis), find a protocol source whose licence allows reuse. pyacaia is AGPL-3.0, so its code cannot be copied. Then add a second Acaia driver and register it in `scale-switch.js` and `scaleBrandOf`.
  4. Other brands (Felicita, Timemore and so on): one driver each, only where a public protocol write-up exists.

## Open questions

- Do both older and newer Acaia models work from public information? Public write-ups exist for the Lunar (2021) and Pyxis, and Acaia is reported to have changed its protocol on newer Pearl firmware, so the models differ. The first piece of work is to list which models have a documented protocol, and to cover those. Models with no public write-up are left out.
- No Acaia scale is available to test with (owner has none). The driver can only be checked against the fake, so every scale other than BOOKOO is "needs verification" in the docs. Who might try one on a real scale?
- Which other scales and in what order? Any with a publicly documented Bluetooth protocol. There is no single standard, so each brand is its own driver. Does each brand go in as its own step under this issue?
- Should timer start, stop and reset be sent to the scale, or should the app time the brew itself for scales that cannot do it? (The brew screen shows time from the scale today.)
- Does the Acaia report battery, flow and a scale-side timer? The screen uses all three for the BOOKOO. What should show for a missing one?
- How does the app tell which brand a device is? Today it checks by Bluetooth service and by name, and remembers devices by id (`bleDeviceIdsV1`). That stored list is likely to need a brand next to each id, and it already lives on user devices, so it needs an upgrade path.
- Is the licence and terms of use of the Acaia protocol, whichever source is used, compatible with a public GitHub repository?
- Should the brew log record which scale was used?
- The roadmap entry "Support for other scales as needed" should become a real item with this issue once the spec is agreed.
