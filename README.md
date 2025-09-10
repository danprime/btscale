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
