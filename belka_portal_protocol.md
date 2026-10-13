# Belka PORTAL — BLE protocol

Reverse-engineered from Belka Android app **v1.4.29** (`com.belka.flBelka`, Flutter / Dart 3.12, `flutter_blue_plus`).
Source: `libapp.so` from `splits/split_config.arm64_v8a.apk`, decompiled with blutter.
Relevant Dart files: `belka_portal_driver.dart`, `bluetooth_device_models.dart`, `bluetooth_device_handler.dart`.

Confidence markers: **[confirmed]** = read directly from code, **[likely]** = strong inference, **[unknown]** = not determined.

---

## 1. Discovery & GATT layout

| Item | Value |
|---|---|
| Advertised name | `BelkaPortal` (app filters scan results by this name) |
| Service | `0x7400` → `00007400-0000-1000-8000-00805f9b34fb` |
| Char `0x7410` | **Live data stream** (notify) |
| Char `0x7411` | Subscribed if it supports notify, but the app never parses it **[unknown purpose]** |
| Char `0x7420` | **Command / response channel** (write + notify) |

Full 128-bit UUIDs (use these in Web Bluetooth):

```
SERVICE  = '00007400-0000-1000-8000-00805f9b34fb'
STREAM   = '00007410-0000-1000-8000-00805f9b34fb'
CHAR7411 = '00007411-0000-1000-8000-00805f9b34fb'
CMD      = '00007420-0000-1000-8000-00805f9b34fb'
```

## 2. Connect / disconnect sequence [confirmed]

1. Scan, match name `BelkaPortal`.
2. Connect (no bonding/pairing, no MTU request for the Portal).
3. `discoverServices()`.
4. For every characteristic in the model (`7410`, `7411`, `7420`) that has notify/indicate: enable notifications (`setNotifyValue(true)`).
5. **Data starts flowing on `0x7410` immediately.** No start command is required to receive EC — the app parses every `0x7410` packet unconditionally.
6. Disconnect = plain GATT disconnect. No "goodbye" command is sent.

## 3. Live stream — char `0x7410` (notify) [confirmed]

Packet length ≥ 13 bytes. Floats are **IEEE-754 float32, little-endian**.

| Offset | Size | Type | Meaning |
|---|---|---|---|
| 0–3 | 4 | float32 LE | **EC** in mS/cm (already calibrated by the device) |
| 4–7 | 4 | float32 LE | Not used by the app. Reads a steady 31.2–31.3 on device (the raw hex jumps only because the low mantissa bits change). **Internal (device) temperature, °C** **[confirmed on device]** |
| 8–11 | 4 | float32 LE | **pTemp** — spout/probe temperature, °C |
| 12 | 1 | uint8 | **Battery %** **[confirmed on device]** |

```js
const dv = event.target.value;           // DataView
const ec   = dv.getFloat32(0, true);     // mS/cm
const temp = dv.getFloat32(8, true);     // °C
const batt = dv.getUint8(12);            // %
```

The app stores `ec`, `pTemp`, and (if a scale is connected) `flow`, `weight`, and `ecFlow = ec × flow`.

## 4. Command channel — char `0x7420`

All commands are written to `0x7420`. Responses arrive as notifications on `0x7420`.
Byte 0 is the message class: `0x00` = parameter read, `0x80` = parameter write, `0x40` = control/log.

### 4.1 Start / stop recording (the "timer") [confirmed]

Written **without response** (if the characteristic supports it).

| Action | Bytes |
|---|---|
| **Start** | `40 00 01 2D` |
| **Stop**  | `40 00 01 2E` |

When the app sends these: Start is sent when an extraction recording starts in the app, either from the manual start button or from auto-start detection. Stop is sent when the recording stops.
The EC stream does **not** depend on these. **[confirmed on device]** Start begins the timer on the device display and beeps. Stop stops the timer and beeps. Whether Start/Stop also creates an on-device log (see 4.5) is not yet confirmed.

### 4.2 Read calibration parameter [confirmed]

Request (write with response): `00 <id> 04`

Response (notify on `0x7420`, ≥ 6 bytes): `00 <id> <float32 BE at bytes 2–5>`
Note: **big-endian**, unlike the stream.

| id | Name |
|---|---|
| `0x03` | `kp` |
| `0x04` | `k1` |
| `0x05` | `k2` |
| `0x06` | `k3` |
| `0x07` | `k4` |
| `0x14` | `tempCal_k` |

The app times out if no response arrives.

### 4.3 Write calibration parameter [confirmed] — ⚠️ changes device calibration

`80 <id> 04 <float32 BE>` (write with response). Same ids as above.
The app's calibration page uses this after measuring a zero point (fresh water) and a reference solution. **Don't experiment with this:** read and save the current values first, because the app warns that calibration is irreversible.

### 4.4 Raw EC (uncalibrated ADC) [confirmed]

Request: `40 05 03`

Response: `40 05 03 <hi> <lo>` → `rawEc = (hi << 8) | lo` (uint16 BE).
The calibration page polls this repeatedly (`belkaGetRawEcSeries`) to average readings.

### 4.5 On-device log upload (device → app) [confirmed structure, some details likely]

The Portal can push a stored extraction log to the phone, which the app saves to its "inbox". The device initiates the exchange. The app only responds.
All messages are `40 01 <sub> …` on `0x7420`. App replies are written without response.

| Step | Device sends | App replies |
|---|---|---|
| Begin | `40 01 00 b3 b4 b5 b6 b7 b8` (≥ 9 B; 6 header bytes, likely the log timestamp) | Resets buffer, sends **current time**: `40 01 01 YY YY MM DD hh mm ss` (year uint16 BE) |
| Query progress | `40 01 02` | `40 01 03 <uint32 BE bytes received so far>`. If no transfer is active: `40 01 0F` |
| Data chunk | `40 01 04 <offset u32 BE> <len u16 BE> <len bytes>` | If offset == bytes received so far: append, then ACK `40 01 05 <cs> <u32 BE new total>` (cs = checksum of the chunk). Otherwise NAK `40 01 0F` and reset |
| Done | `40 01 06` | Saves log |
| Abort | `40 01 0F` | Clears buffer |

Checksum (`_checksum2comp`): `(-(sum of bytes)) & 0xFF`, the 8-bit two's complement of the byte sum.

Log payload: the assembled bytes are read as a **float32 LE array**. The first half is the EC series and the second half is the temperature series. The title is the timestamp formatted `yy MM-dd HH:mm`.

## 5. App-side logic worth copying (optional)

- **Auto-start**: triggers when EC rises above **6.0 mS/cm** over a few consecutive samples (`checkEcRisingTrigger`). The app also ships an ONNX model (`extraction_detector_*.onnx`). It classifies a 50-sample window of `[EC, Temp]` as `idle / starting / extracting`.
- **Espresso auto-stop** (`_checkEspressoStopTrigger`): fires after enough samples once EC falls below about 0.5× its earlier level **[likely; thresholds approximate]**.
- Sample rate: set by the device. Timestamp packets on arrival.

## 6. Minimal Web Bluetooth example

```js
const SVC = '00007400-0000-1000-8000-00805f9b34fb';
const STREAM = '00007410-0000-1000-8000-00805f9b34fb';
const CMD = '00007420-0000-1000-8000-00805f9b34fb';

const device = await navigator.bluetooth.requestDevice({
  filters: [{ name: 'BelkaPortal' }], optionalServices: [SVC],
});
const server = await device.gatt.connect();
const svc = await server.getPrimaryService(SVC);

const stream = await svc.getCharacteristic(STREAM);
stream.addEventListener('characteristicvaluechanged', (e) => {
  const dv = e.target.value;
  if (dv.byteLength < 13) return;
  record({ t: performance.now(), ec: dv.getFloat32(0, true), temp: dv.getFloat32(8, true), batt: dv.getUint8(12) });
});
await stream.startNotifications();

const cmd = await svc.getCharacteristic(CMD);
cmd.addEventListener('characteristicvaluechanged', (e) => console.log('7420 <-', new Uint8Array(e.target.value.buffer)));
await cmd.startNotifications();

const send = (bytes) => cmd.properties.writeWithoutResponse
  ? cmd.writeValueWithoutResponse(new Uint8Array(bytes))
  : cmd.writeValueWithResponse(new Uint8Array(bytes));

const start = () => send([0x40, 0x00, 0x01, 0x2D]);
const stop  = () => send([0x40, 0x00, 0x01, 0x2E]);
const readParam = (id) => cmd.writeValueWithResponse(new Uint8Array([0x00, id, 0x04])); // reply arrives on 7420
const readRawEc = () => cmd.writeValueWithResponse(new Uint8Array([0x40, 0x05, 0x03]));

// disconnect
// device.gatt.disconnect();
```

## 7. Open questions (verify with nRF Connect or an HCI snoop log)

- Purpose of char `0x7411`.
- Whether Start/Stop also creates a stored log on the device (check if a log upload, `40 01 00 …`, follows a stop).

---

## Appendix — Belka FILTER (`PF_Server`), partial

The app also supports a second device, the Belka Filter. It has the same service `0x7400` but a different scheme:

- On connect, the app **reads** chars `7423` (ratio), `7424`–`7427` (K1–K4, float32 BE), and `7451` (spoutTempOffset at bytes 8–11, KSpan at bytes 16–19, both float32 BE). It then **writes `01 31`** to char `7440`, which is presumably "start streaming".
- Stream on `7410` (≥ 14 B): temperature is a 24-bit int at bytes 6–8, and EC is a 24-bit int at bytes 9–11. The app converts both to engineering units:
  - EC = `KSpan × ratio × (polynomial of K1–K4)`.
  - Temperature: the 24-bit value is turned into a thermistor resistance, using constants 40950000 and 10000, then a polynomial fit with `spoutK1`, `spoutK2` and `spoutTempOffset`.
- No start/stop commands for the Filter.

The scale drivers (Acaia, Bookoo, DiFluid, Felicita) are also in the app but out of scope here.
