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

Contact
- If you want, I can add a ready-made UMD build, TypeScript declarations, or a short package.json for publishing to npm.
