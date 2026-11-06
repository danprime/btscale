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
- [ ] `belka_portal_protocol.md` and `docs/product/features/connecting-devices.md` say which scales are supported, and the stale line is gone.

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

- Done: nothing built. Issue and code read; this spec drafted.
- Next steps:
  1. Answer the open questions, in particular which Acaia models and whether a real one is available.
  2. Research the Acaia Bluetooth protocol from a source the owner trusts (service and characteristic IDs, the handshake, weight packet layout, tare and timer commands) and add it as a protocol file beside `bookoo_protocols.md`. Nothing here is verified against a real scale yet.
  3. Split `ble-scale.js` and `bookoo-scale.js` so a scale driver can be chosen by brand, keeping the BOOKOO behaviour byte for byte.
  4. Add the fake Acaia to `ble-mock.js`, then the driver, then the device manager changes, then the docs.

## Open questions

- Which Acaia models matter? The company has made several generations (for example Lunar, Pearl, Pyxis) and the older ones and the newer ones use different Bluetooth schemes. This changes the size of the work.
- Is there an Acaia scale available to test with? The constraints say a new scale needs "the device in hand". Without one, the driver can only be checked against the fake.
- "Other BLE scales": which ones, in what order? There is no single standard Bluetooth protocol for coffee scales, so each brand is its own driver. Is one brand per issue acceptable, with this issue covering Acaia and the others tracked separately?
- Should timer start, stop and reset be sent to the scale, or should the app time the brew itself for scales that cannot do it? (The brew screen shows time from the scale today.)
- Does the Acaia report battery, flow and a scale-side timer? The screen uses all three for the BOOKOO. What should show for a missing one?
- How does the app tell which brand a device is? Today it checks by Bluetooth service and by name, and remembers devices by id (`bleDeviceIdsV1`). That stored list is likely to need a brand next to each id, and it already lives on user devices, so it needs an upgrade path.
- Is the licence and terms of use of the Acaia protocol, whichever source is used, compatible with a public GitHub repository?
- Should the brew log record which scale was used?
- "Only two devices are supported" in `docs/product/constraints.md`, and "Support for other scales as needed" in the roadmap: both change if this goes ahead. They are not edited here, because this is still a draft.
- Does this need a decision record (adding a second brand of device driver changes how devices are chosen and stored)?
