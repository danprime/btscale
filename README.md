# bookooscale

[![Playwright Tests](https://github.com/danprime/bookooscale/actions/workflows/playwright.yml/badge.svg)](https://github.com/danprime/bookooscale/actions/workflows/playwright.yml)

This repository contains the BOOKOO Mini Scale Reader web UI and Playwright tests. The Playwright CI runs only on Chromium because BLE functionality and the Bluetooth Web API work reliably only on Chromium-based browsers.
## Using ble-scale.js

This project includes a small ESM library `ble-scale.js` that wraps Web Bluetooth interactions for the BOOKOO Mini Scale. You can reuse it in other projects; below are quick integration notes and examples.

Important constraints
- Web Bluetooth requires a secure context (HTTPS) or `localhost` during development.
- `requestDevice()` must be invoked from a user gesture (button click).
- Browser support: Chrome / Chromium-based browsers have the best support; Safari's Web Bluetooth support is limited.

Quick example (ESM)

```javascript
import { BleScale } from './ble-scale.js';
import { parseWeightData } from './scale-utils.js';

const ble = new BleScale();
document.getElementById('connectBtn').addEventListener('click', async () => {
	try {
		const info = await ble.connect();
		ble.addEventListener('value', (ev) => {
			const buf = ev.target.value.buffer;
			const data = parseWeightData(new Uint8Array(buf));
			if (data) updateDisplay(data);
		});
		ble.addEventListener('disconnect', () => updateStatus('Disconnected'));
	} catch (err) {
		console.error('BLE connect failed', err);
	}
});
```

Testing and mocks
- Use the exported `installMock()` helper during tests to install a test-only `navigator.bluetooth` mock. It returns `{ uninstall, getWeightCharacteristic }` so your test can both call the real `ble.connect()` path and emit `characteristicvaluechanged` events via `getWeightCharacteristic().__emit(buffer)`.

Example test usage:

```javascript
import { installMock } from './ble-scale.js';
const mock = installMock();
// ... run code that calls ble.connect() ...
const char = await mock.getWeightCharacteristic();
char.__emit(buffer);
mock.uninstall();
```

Bundling & compatibility
- `ble-scale.js` is authored as ESM. If you need to support non-ESM consumers, build a UMD/CJS bundle with Rollup or your bundler and publish that artifact.
- Consider adding a `types` file or `.d.ts` if you need TypeScript support.

Configuration
- If your scale/firmware uses different service/characteristic UUIDs, update the constants in `ble-scale.js` or instantiate the class with a custom `bluetooth` injection.

## Using bookoo-scale.js (ScaleController)

`bookoo-scale.js` provides a higher-level, scale-focused API on top of `ble-scale.js`.
It constructs the 6-byte commands the BOOKOO firmware expects, parses incoming weight packets, and emits convenient events for your UI.

Key features
- connect/disconnect and connection state management
- high-level commands: `tare()`, `tareAndStart()`, `startTimer()`, `stopTimer()`, `resetTimer()`
- settings commands: `setBeep(level)`, `setAutoOff(minutes)`, `setFlowSmoothing(enabled)`
- emits `raw` (Uint8Array), `data` (parsed scale object), `connected`, `disconnected`, `error` events

Browser usage (ESM)

```javascript
import ScaleController from './bookoo-scale.js';
// Optionally install the BLE mock in tests: ScaleController.installMock()

const sc = new ScaleController();
document.getElementById('connectBtn').addEventListener('click', async () => {
	try {
		const info = await sc.connect({ services: [0x0FFE] });
		console.log('Connected', info.name);
		sc.addEventListener('data', (parsed) => {
			// parsed: { milliseconds, weight, flowRate, batteryPercent, ... }
			updateDisplay(parsed);
		});
		sc.addEventListener('raw', (buf) => {
			// raw Uint8Array of the 20-byte notification
			console.log('raw packet', buf);
		});
		sc.addEventListener('disconnected', () => updateStatus('Disconnected'));
	} catch (err) {
		console.error('Connection failed', err);
	}
});

// Example sending commands
async function tareAndStart() {
	if (!sc.isConnected()) return;
	await sc.tareAndStart();
}

async function setBeepLevel(level) {
	if (!sc.isConnected()) return;
	await sc.setBeep(level);
}
```

Testing and mock usage

`ScaleController.installMock()` delegates to the low-level mock in `ble-scale.js`. In Playwright or browser tests you can:

```javascript
// In test page context
window.__mock = ScaleController.installMock();
// call the app's connect code which will use the mocked navigator.bluetooth
await connectToScale();
// emit a fake notification
const char = await window.__mock.getWeightCharacteristic();
char.__emit(buffer);
// remove mock
window.__mock.uninstall();
```

Notes
- `ScaleController` is ESM and expects to be run in a secure context (HTTPS or localhost).
- The parsed `data` object shape comes from `scale-utils.js`'s `parseWeightData()` and includes `weight` (grams), `flowRate` (g/s), `batteryPercent`, and timing fields.
- If you need a CommonJS/UMD bundle or TypeScript types, I can add a build step and `.d.ts` file.

## EC meter support (Belka PORTAL)

The app can also connect to a Belka PORTAL EC meter alongside the scale. Weight stays the main reading; with the EC meter connected, Temperature (°C) and EC (mS/cm) cards appear under the scale panels.

Files
- `belka-portal.js` - `BelkaPortal` driver: connects (service `0x7400`), parses the 13-byte stream packet (`parsePortalPacket()`), and sends start/stop timer commands. Protocol notes: `belka_portal_protocol.md`.
- `device-manager.js` - `DeviceManager` owns both connections and implements the single Connect button.
- `brew-recorder.js` - `BrewRecorder` records weight, flow, temperature and EC between Start and Stop and produces the CSV.
- `tds.js` - TDS maths: EC at 25 °C, the Cumulative Ionic Yield (`CiyIntegrator`), live yield, TDS and the calibration constant k_v.
- `emitter.js` - shared `SimpleEmitter` (multiple listeners per event).
- `ble-mock.js` - `installMockBluetooth({ devices, permitted })`, a multi-device `navigator.bluetooth` mock used by the tests.

Connecting
- One Connect button (Settings). Browsers allow only one device picker per tap, so the first time you press it once per device: the picker lists both device types, and the next press offers whichever is still missing.
- Devices you have connected before are reconnected without a picker where the browser supports `navigator.bluetooth.getDevices()`, so one press connects both.
- With both connected the button becomes Disconnect (both). With only one connected, a separate Disconnect button is shown.
- Header icons show what is connected: a weight for the scale, a lightning bolt for the EC meter (hover for battery %). The status line under the header is only shown for connection errors.

Timer
- Settings > "Start/Stop also controls" chooses which connected devices the Start/Stop button drives (scale timer, EC meter timer + beep). Only connected devices are sent commands.
- Elapsed time comes from the scale's timer when the scale is connected and driven; otherwise the app's own clock is used.

Ratio and target weight
- Settings > Memory: Bean Dose and Carafe/Server are typed in (Overwrite turns the value into an input, above 0 and up to 5000 g; Enter or Save stores it, Escape cancels). Settings never takes the scale's reading; the M_B button on the main screen still stores the bean weight from the scale.
- Settings > Memory has a Ratio row (default 1:15). Overwrite turns the number into an input (above 0, up to 30, decimals allowed); Enter or Save stores it, Escape cancels.
- The target weight is always the stored bean dose × that ratio. The Target Weight card shows both, e.g. "20g<sub>in</sub> → 300g<sub>out</sub>" (or "-- g" without a bean dose). When three cards share the row (e.g. Avg flow, Target, Yield after Stop) it drops the subscripts: "20g → 300g". It updates whenever either changes, including on page load, and is not cleared when the scale disconnects.

Brew chart
- A live line chart sits under the weight, timer and ratio (it replaced the progress ring). With the EC meter connected it plots EC on a fixed 0-5 mS/cm axis (stretched if a reading goes higher), plus weight as a thinner second line. The weight (grams) axis always stays on the left; with the EC meter, the EC axis is on the right. With only the scale it plots weight alone. The target weight shows as a dashed line.
- The time axis covers the whole brew from Start to now. The finished curve stays after Stop and clears on Reset. Code: `brew-chart.js`.

After Stop
- Until Reset, the weight, timer and ratio show the brew's final values ("Final · grams"), and the chart stays frozen. The cards show average flow (final weight ÷ time), temperature at stop and peak EC.
- Live readings (weight, temperature, EC) appear in a slim line under the chart, so you can still weigh the cup or check temperature. Reset returns everything to live.

TDS (scale and EC meter both connected)
- The Portal's EC is already temperature-compensated to 25 °C on the device (EC = calibrated reading / (1 + tempCal_k × (T − 25)); see `getTemporalEc` in the Belka app), so the app uses it as-is.
- Cumulative Ionic Yield (CIY) is a Riemann sum over the water poured (the scale sits under the brewer; 1 g ≈ 1 mL): every EC reading adds EC × the grams poured since the previous reading. Water is measured against the highest weight so far, so scale noise or a bumped scale never counts twice.
- Live yield = water poured − bean dose × bed absorption (Settings > Memory > Bed absorption, default 2.0 g/g, 0 to 5).
- TDS % = 100 × k_v × CIY / yield. While brewing, the TDS ≈ card (between Temperature and EC) shows the estimate from the live yield, starting 30 s after Start. Until k_v is calibrated a rough default of 0.005 is used, and the card ("TDS ≈ (uncal.)"), the calculator and Settings mark it as uncalibrated.
- After Stop, CIY replaces the EC card and the M_B button becomes a calculator. It shows the live scale weight, the Carafe/Server memory and the yield (scale − carafe until you edit it), plus a Tare button; opening it never tares. Next sets the final TDS and adds a Yield card. With only one of the devices, none of this appears.
- Calibration (Settings > Memory > k_v > Calibrate) uses the last finished TDS brew (saved across reloads): enter the refractometer TDS % (and the yield if needed) and k_v = TDS % × yield / (100 × CIY) is shown as you type. Step 2 compares it with the current k_v and the last 3 calibrations (with their average); the new value can be edited before saving. Each calibration adds one history entry: the saved value, or the calculated one if you keep the current k_v.
- Stored in localStorage: `tdsKvV1`, `kvHistoryV1`, `bedAbsorptionV1`, `lastBrewV1`.

TDS vs extraction chart (after a TDS brew)
- During a brew with the scale and EC meter connected, and after one is stopped, the chart area is a two-slide carousel: swipe, or tap the dots in its header. It stays on the brew chart unless you swipe. Slide 2 plots TDS % (left) against extraction yield % (bottom; 14-26 %, TDS 0.8-1.6 %), with the gold cup zone (18-22 %, 1.15-1.35 %) shaded.
- While brewing (from 30 s, like the live TDS) the TDS vs extraction slide shows a live hollow dot (where the cup would land if you stopped now) and a trail of the path so far, clipped at the chart edges. Live extraction = 100 × k_v × CIY / dose, so it only moves right; TDS usually falls as weaker liquid is added.
- Extraction yield % = yield (g) × TDS % / bean dose (g). Right after Stop the brew is a hollow dot from the estimated yield and TDS; after the calculator's Next it turns solid (measured yield and final TDS), the trail is removed and the carousel switches to this chart. A brew outside the axes is pinned to the edge; its label shows the real values.
- Tap the chart to show or hide the four region labels (Strong & Sour, Strong & Bitter, Weak & Under-extracted, Weak & Over-extracted). Reset returns to the brew chart alone.

Recording
- Samples are recorded from Start to Stop. After Stop, a download button exports a CSV with one row per packet from either device (`t_s,weight_g,flow_gps,temp_c,ec_mScm,source,ciy,tds_pct`), with the latest value from the other device filled in. The last two columns are only filled during a TDS brew (`tds_pct` is the live estimate).
