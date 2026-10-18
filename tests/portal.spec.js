const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');

function createStaticServer(root, port = 0) {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);
    let pathname = decodeURIComponent(parsed.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(root, pathname);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const map = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', map[ext] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port: server.address().port }));
  });
}

let server;
let baseUrl;

test.beforeEach(async ({ page }) => {
  const started = await createStaticServer(path.resolve(__dirname, '..'), 0);
  server = started.server;
  baseUrl = `http://localhost:${started.port}`;
  await page.goto(`${baseUrl}/index.html`);
  // Helper in page: emit a BOOKOO weight packet (weight in g, ms on the scale timer)
  await page.evaluate(() => {
    window.__emitScale = async (mock, weight, ms = 0, flow = 0) => {
      const b = new Uint8Array(20);
      b[0] = 0x03; b[1] = 0x0B;
      b[2] = (ms >> 16) & 0xff; b[3] = (ms >> 8) & 0xff; b[4] = ms & 0xff;
      const w = Math.round(weight * 100);
      b[7] = (w >> 16) & 0xff; b[8] = (w >> 8) & 0xff; b[9] = w & 0xff;
      const f = Math.round(flow * 100);
      b[11] = (f >> 8) & 0xff; b[12] = f & 0xff;
      b[13] = 80;
      let cs = 0; for (let i = 0; i < 19; i++) cs ^= b[i];
      b[19] = cs;
      (await mock.getWeightCharacteristic()).__emit(b);
    };
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__mock?.uninstall());
  await new Promise((r) => server.close(r));
});

test('parsePortalPacket decodes the 13-byte stream packet', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { parsePortalPacket } = await import('./belka-portal.js');
    const dv = new DataView(new ArrayBuffer(13));
    dv.setFloat32(0, 4.25, true);
    dv.setFloat32(4, 31.25, true);
    dv.setFloat32(8, 88.5, true);
    dv.setUint8(12, 64);
    return { ok: parsePortalPacket(new Uint8Array(dv.buffer)), short: parsePortalPacket(new Uint8Array(12)) };
  });
  expect(result.ok).toEqual({ ec: 4.25, internalTemp: 31.25, temp: 88.5, battery: 64 });
  expect(result.short).toBeNull();
});

test('single connect button connects both devices, then disconnects both', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] }); });
  const connectBtn = page.locator('#connectToggleBtn');
  await expect(page.locator('#scaleIcon')).toBeHidden();
  await expect(page.locator('#portalIcon')).toBeHidden();
  await expect(page.locator('#portalInfo')).toBeHidden();

  // First press: picker offers both types; the mock "user" picks the scale.
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toBeVisible();
  await expect(page.locator('#portalIcon')).toBeHidden();
  await expect(connectBtn).toHaveText('Connect EC meter');

  // Second press: picker only offers the missing EC meter.
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#portalIcon')).toBeVisible();
  await expect(page.locator('#portalInfo')).toBeVisible();
  await expect(connectBtn).toHaveText('Disconnect');
  const filters = await page.evaluate(() => window.__mock.mock.requests.map((r) => r.filters));
  expect(filters[0].length).toBe(2);
  expect(filters[1]).toEqual([{ name: 'BelkaPortal' }]);

  // Readings reach the cards; weight stays the hero value.
  await page.evaluate(() => window.__mock.emitPortal({ ec: 3.456, temp: 91.24, battery: 70 }));
  await page.evaluate(() => window.__emitScale(window.__mock, 150.2));
  await expect(page.locator('#tempValue')).toHaveText('91.2 °C');
  await expect(page.locator('#ecValue')).toHaveText('3.46 mS/cm');
  await expect(page.locator('#weightDisplay')).toHaveText('150.2');

  // Third press disconnects both.
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toBeHidden();
  await expect(page.locator('#portalIcon')).toBeHidden();
  await expect(page.locator('#portalInfo')).toBeHidden();
  await expect(connectBtn).toHaveText('Connect');
});

test('remembered devices reconnect with one press and no picker', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('bleDeviceIdsV1', JSON.stringify({ scale: 'mock-scale-id', portal: 'mock-portal-id' }));
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'], permitted: ['scale', 'portal'] });
  });
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toBeVisible();
  await expect(page.locator('#portalIcon')).toBeVisible();
  expect(await page.evaluate(() => window.__mock.mock.requests.length)).toBe(0);
});

test('scale-only user: cancelled EC picker keeps scale connected and Disconnect works', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale'] }); });
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toBeVisible();
  // Pressing again finds no EC meter (picker cancelled) - nothing breaks.
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toBeVisible();
  await expect(page.locator('#connectToggleBtn')).toHaveText('Connect EC meter');
  // Separate Disconnect button disconnects the scale.
  await page.click('#settingsBtn');
  await page.click('#disconnectAllBtn');
  await expect(page.locator('#scaleIcon')).toBeHidden();
  await expect(page.locator('#disconnectAllBtn')).toBeHidden();
});

test('timer drives the devices selected in settings', async ({ page }) => {
  await page.evaluate(async () => {
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] });
    await toggleConnect();
    await toggleConnect();
  });
  await expect(page.locator('#portalIcon')).toBeVisible();

  await page.evaluate(() => triStateTimer()); // start
  await page.evaluate(() => triStateTimer()); // stop
  let writes = await page.evaluate(() => ({ portal: window.__mock.portalCommandWrites(), scale: window.__mock.scaleCommandWrites() }));
  expect(writes.portal).toEqual([[0x40, 0x00, 0x01, 0x2d], [0x40, 0x00, 0x01, 0x2e]]);
  expect(writes.scale).toEqual([[0x03, 0x0a, 0x04, 0x00, 0x00, 0x0a], [0x03, 0x0a, 0x05, 0x00, 0x00, 0x0d]]);
  await page.evaluate(() => triStateTimer()); // reset (scale only)

  // Untick the EC meter: start/stop only go to the scale.
  await page.click('#settingsBtn');
  await page.uncheck('#drivePortalTimer');
  await page.evaluate(() => closeSettingsModal());
  await page.evaluate(() => triStateTimer());
  await page.evaluate(() => triStateTimer());
  writes = await page.evaluate(() => ({ portal: window.__mock.portalCommandWrites(), scale: window.__mock.scaleCommandWrites() }));
  expect(writes.portal.length).toBe(2);
  expect(writes.scale.length).toBe(5);
  // Setting is persisted
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timerDrivesV1')))).toEqual({ scale: true, portal: false });
});

test('EC meter only: elapsed time comes from the app timer', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['portal'] }); });
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#portalIcon')).toBeVisible();
  await expect(page.locator('#timerToggleBtn')).toBeEnabled();
  await expect(page.locator('#tareBtn')).toBeDisabled();
  await page.evaluate(() => triStateTimer());
  await expect(page.locator('#timer')).toHaveText('0:01', { timeout: 3000 });
  await page.evaluate(() => triStateTimer());
});

test('brew is recorded and exported as merged CSV', async ({ page }) => {
  await page.evaluate(async () => {
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] });
    await toggleConnect();
    await toggleConnect();
  });
  await expect(page.locator('#exportCsvBtn')).toBeHidden();
  await page.evaluate(() => triStateTimer()); // start recording
  await page.evaluate(async () => {
    await window.__emitScale(window.__mock, 0.0, 100, 0);
    window.__mock.emitPortal({ ec: 0.12, temp: 92.1 });
    await window.__emitScale(window.__mock, 0.3, 200, 0.15);
  });
  await expect(page.locator('#exportCsvBtn')).toBeHidden(); // hidden while running
  await page.evaluate(() => triStateTimer()); // stop
  await expect(page.locator('#exportCsvBtn')).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsvBtn')]);
  expect(download.suggestedFilename()).toMatch(/^brew-\d{4}-\d{2}-\d{2}_\d{6}\.csv$/);
  const csv = fs.readFileSync(await download.path(), 'utf8').trim().split('\n');
  expect(csv[0]).toBe('t_s,weight_g,flow_gps,temp_c,ec_mScm,source');
  const rows = csv.slice(1).map((l) => l.split(','));
  expect(rows.map((r) => r[5])).toEqual(['scale', 'portal', 'scale']);
  expect(rows[0].slice(1, 5)).toEqual(['0.0', '0.00', '', '']);
  expect(rows[1].slice(1, 5)).toEqual(['0.0', '0.00', '92.1', '0.120']);
  expect(rows[2].slice(1, 5)).toEqual(['0.3', '0.15', '92.1', '0.120']);
});

test('EC meter dropping out mid-brew hides its cards and keeps the scale running', async ({ page }) => {
  await page.evaluate(async () => {
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] });
    await toggleConnect();
    await toggleConnect();
  });
  await page.evaluate(() => triStateTimer());
  await page.evaluate(() => window.__mock.device('portal').gatt.disconnect());
  await expect(page.locator('#portalIcon')).toBeHidden();
  await expect(page.locator('#portalInfo')).toBeHidden();
  await expect(page.locator('#scaleIcon')).toBeVisible();
  await expect(page.locator('#connectToggleBtn')).toHaveText('Connect EC meter');
  // Timer is still running (stop icon) and the scale still updates.
  await expect(page.locator('#timerBtnIcon .lucide-square')).toBeVisible();
  await page.evaluate(() => window.__emitScale(window.__mock, 42.0, 5000));
  await expect(page.locator('#weightDisplay')).toHaveText('42.0');
});

test('brew chart plots EC with the EC meter, weight without it, and clears on reset', async ({ page }) => {
  const chart = page.locator('#brewChartCanvas');
  const label = page.locator('#brewChartLabel');

  // Scale only: weight chart
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] }); });
  await page.evaluate(() => toggleConnect());
  await expect(label).toHaveText('Weight · g');
  await page.evaluate(() => triStateTimer());
  await page.evaluate(() => window.__emitScale(window.__mock, 25.5, 1000));
  await expect(chart).toHaveAttribute('aria-label', /^Weight chart, latest 25\.5 g at 0:\d\d$/);
  await page.evaluate(() => triStateTimer()); // stop: curve stays
  await expect(chart).toHaveAttribute('aria-label', /latest 25\.5 g/);
  await page.evaluate(() => triStateTimer()); // reset: cleared
  await expect(chart).toHaveAttribute('aria-label', 'Weight chart, no data yet. Press Start');

  // EC meter connected: EC chart
  await page.evaluate(() => toggleConnect());
  await expect(label).toHaveText(/^EC · mS\/cm\s*Weight · g$/);
  await page.evaluate(() => triStateTimer());
  await page.evaluate(() => window.__mock.emitPortal({ ec: 3.14, temp: 90 }));
  await expect(chart).toHaveAttribute('aria-label', /^EC chart, latest 3\.14 mS\/cm at 0:\d\d$/);
  // Weight is added as a second line on the EC chart
  await page.evaluate(() => window.__emitScale(window.__mock, 48.2, 2000));
  await expect(chart).toHaveAttribute('aria-label', /^EC chart, latest 3\.14 mS\/cm at 0:\d\d; weight 48\.2 g$/);
});

test('remembered device out of range: reconnect times out, is forgotten, next press shows the picker', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('bleDeviceIdsV1', JSON.stringify({ scale: 'mock-scale-id', portal: 'mock-portal-id' }));
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'], permitted: ['scale', 'portal'] });
    window.__mock.device('scale').gatt.hang = true; // scale switched off / out of range
    window.__devices.reconnectTimeoutMs = 300;
  });
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#portalIcon')).toBeVisible();
  await expect(page.locator('#scaleIcon')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bleDeviceIdsV1')))).toEqual({ portal: 'mock-portal-id' });
  expect(await page.evaluate(() => window.__mock.mock.requests.length)).toBe(0);

  // Scale back in range: the next press opens the picker for the scale only.
  await page.evaluate(() => { window.__mock.device('scale').gatt.hang = false; });
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toBeVisible();
  const requests = await page.evaluate(() => window.__mock.mock.requests.map((r) => r.filters));
  expect(requests).toEqual([[{ services: [0x0ffe] }]]);
});

test('scale timer not driven: elapsed time comes from the app clock, not the scale', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale'] }); });
  await page.evaluate(() => toggleConnect());
  await page.click('#settingsBtn');
  await page.uncheck('#driveScaleTimer');
  await page.evaluate(() => closeSettingsModal());
  await page.evaluate(() => triStateTimer());
  // The scale's own timer says 1:30, but it isn't the time source.
  await page.evaluate(() => window.__emitScale(window.__mock, 10, 90000));
  await expect(page.locator('#timer')).toHaveText('0:00');
  await expect(page.locator('#timer')).toHaveText('0:01', { timeout: 3000 });
  expect(await page.evaluate(() => window.__mock.scaleCommandWrites().length)).toBe(0);
  await page.evaluate(() => triStateTimer());
});

test('reconnecting does not duplicate data events', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] }); });
  // First time: one press per device. Afterwards both are remembered, so one press reconnects both.
  await page.evaluate(async () => { await toggleConnect(); await toggleConnect(); });
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('#connectToggleBtn')).toHaveText('Disconnect');
    await page.evaluate(() => disconnect());
    await page.evaluate(() => toggleConnect());
  }
  await expect(page.locator('#connectToggleBtn')).toHaveText('Disconnect');
  await page.evaluate(() => triStateTimer());
  await page.evaluate(async () => {
    await window.__emitScale(window.__mock, 12.3, 100);
    window.__mock.emitPortal({ ec: 1.5, temp: 90 });
  });
  await page.evaluate(() => triStateTimer());
  expect(await page.evaluate(() => window.__test_recorder.rows.map((r) => r.source))).toEqual(['scale', 'portal']);
});

test('both devices dropping mid-brew stops the brew and keeps the data for export', async ({ page }) => {
  await page.evaluate(async () => {
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] });
    await toggleConnect();
    await toggleConnect();
  });
  await page.evaluate(() => triStateTimer());
  await page.evaluate(async () => {
    await window.__emitScale(window.__mock, 50, 1000);
    window.__mock.emitPortal({ ec: 2, temp: 90 });
    window.__mock.device('scale').gatt.disconnect();
    window.__mock.device('portal').gatt.disconnect();
  });
  await expect(page.locator('#timerBtnIcon .lucide-rotate-ccw')).toBeVisible();
  await expect(page.locator('#timerToggleBtn')).toBeDisabled();
  await expect(page.locator('#exportCsvBtn')).toBeVisible();
  expect(await page.evaluate(() => window.__test_recorder.running)).toBe(false);
  expect(await page.evaluate(() => window.__test_recorder.rows.length)).toBe(2);
});

test('parsePortalPacket reads a DataView that starts at an offset', async ({ page }) => {
  const parsed = await page.evaluate(async () => {
    const { parsePortalPacket } = await import('./belka-portal.js');
    const buf = new ArrayBuffer(20);
    const dv = new DataView(buf, 3, 13);
    dv.setFloat32(0, 2.5, true);
    dv.setFloat32(4, 30.5, true);
    dv.setFloat32(8, 91.25, true);
    dv.setUint8(12, 55);
    new Uint8Array(buf, 0, 3).fill(0xff); // junk before the packet
    return parsePortalPacket(dv);
  });
  expect(parsed).toEqual({ ec: 2.5, internalTemp: 30.5, temp: 91.25, battery: 55 });
});

test('chart hint asks to connect until a device is connected', async ({ page }) => {
  const chart = page.locator('#brewChartCanvas');
  await expect(chart).toHaveAttribute('aria-label', 'Weight chart, no data yet. Please connect device and press start');
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale'] }); });
  await page.evaluate(() => toggleConnect());
  await expect(chart).toHaveAttribute('aria-label', 'Weight chart, no data yet. Press Start');
  await page.evaluate(() => disconnect());
  await expect(chart).toHaveAttribute('aria-label', 'Weight chart, no data yet. Please connect device and press start');
});

for (const size of [{ width: 375, height: 812 }, { width: 375, height: 667 }]) {
  test(`page does not scroll and buttons sit at the bottom on a ${size.width}x${size.height} phone`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.reload();
    const dims = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      view: innerHeight,
      buttonsBottom: document.querySelector('.ritual-main-actions').getBoundingClientRect().bottom,
    }));
    expect(dims.doc).toBe(dims.view);
    // Main buttons sit at the bottom of the screen (thumb reach), not mid-page
    expect(dims.view - dims.buttonsBottom).toBeLessThanOrEqual(20);
  });
}

test('after Stop the main readouts freeze on final values and live readings move to the strip', async ({ page }) => {
  const text = (id) => page.locator(`#${id}`);
  await page.evaluate(async () => {
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] });
    await toggleConnect();
    await toggleConnect();
    window.__test_setMemory({ beans: { weight: 16 } });
  });
  await page.evaluate(() => triStateTimer()); // start
  await page.evaluate(async () => {
    window.__mock.emitPortal({ ec: 4.2, temp: 92 });
    window.__mock.emitPortal({ ec: 1.1, temp: 87.2 });
    await window.__emitScale(window.__mock, 240.6, 121000, 2);
  });
  await page.evaluate(() => triStateTimer()); // stop
  // Cup lifted after the brew: live weight drops and the scale reports a flow spike
  await page.evaluate(async () => {
    await window.__emitScale(window.__mock, 80.3, 121000, 344.3);
    window.__mock.emitPortal({ ec: 0.92, temp: 88 });
  });

  await expect(text('weightUnitLabel')).toHaveText('Final');
  await expect(text('weightUnit')).toBeVisible();
  await expect(text('weightDisplay')).toHaveText('240.6');
  await expect(text('timer')).toHaveText('2:01');
  await expect(text('calculatedRatioDisplay')).toHaveText('1:15.0');
  await expect(text('flowRateLabel')).toHaveText('Avg flow');
  await expect(text('flowRate')).toHaveText('2.0 g/s');
  await expect(text('tempLabel')).toHaveText('Temp at stop');
  await expect(text('tempValue')).toHaveText('87.2 °C');
  await expect(text('ecLabel')).toHaveText('Peak EC');
  await expect(text('ecValue')).toHaveText('4.20 mS/cm');
  await expect(text('liveStrip')).toBeVisible();
  await expect(text('liveStrip')).toHaveText('Live 80.3 g · 88.0 °C · 0.92 mS/cm');

  // Reset: back to live readings
  await page.evaluate(() => triStateTimer());
  await expect(text('weightUnitLabel')).toBeHidden(); // live weight: no "grams" label
  await expect(text('weightDisplay')).toHaveText('80.3');
  await expect(text('weightUnit')).toHaveText('g');
  await expect(text('flowRateLabel')).toHaveText('Flow Rate');
  await expect(text('tempValue')).toHaveText('88.0 °C');
  await expect(text('ecLabel')).toHaveText('EC');
  await expect(text('ecValue')).toHaveText('0.92 mS/cm');
  await expect(text('liveStrip')).toBeHidden();
});

test('weight readout: "grams" placeholder until there is a weight, then the decimal point stays one digit right of centre', async ({ page }) => {
  await expect(page.locator('#weightUnitLabel')).toHaveText('grams');
  await expect(page.locator('#weightUnitLabel')).toBeVisible();
  await expect(page.locator('#weightDisplay')).toHaveText('--');
  await expect(page.locator('#weightUnit')).toBeHidden();

  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale'] }); });
  await page.evaluate(() => toggleConnect());
  const positions = [];
  for (const w of [1.2, 24.5, 240.6]) {
    await page.evaluate((w) => window.__emitScale(window.__mock, w, 1000), w);
    await expect(page.locator('#weightDisplay')).toHaveText(w.toFixed(1));
    positions.push(await page.evaluate(() => {
      const card = document.querySelector('.ritual-container').getBoundingClientRect();
      const frac = document.querySelector('#weightDisplay .w-frac');
      const range = document.createRange();
      range.setStart(frac.firstChild, 0);
      range.setEnd(frac.firstChild, 1); // the "." glyph
      const dot = range.getBoundingClientRect();
      const probe = document.createElement('span'); // width of one digit at the readout's size
      probe.textContent = '0';
      document.querySelector('#weightDisplay .w-int').appendChild(probe);
      const digit = probe.getBoundingClientRect().width;
      probe.remove();
      return (dot.left + dot.right) / 2 - (card.left + card.right) / 2 - digit;
    }));
  }
  await expect(page.locator('#weightUnitLabel')).toBeHidden();
  await expect(page.locator('#weightUnit')).toHaveText('g');
  for (const offset of positions) expect(Math.abs(offset)).toBeLessThanOrEqual(3); // point one digit right of centre

  await page.evaluate(() => disconnect());
  await expect(page.locator('#weightDisplay')).toHaveText('--');
  await expect(page.locator('#weightUnitLabel')).toBeVisible();
});

test('ratio setting: default 1:15, Overwrite edits it, target weight = bean dose x ratio', async ({ page }) => {
  const target = page.locator('#targetWeight');
  await expect(page.locator('#ratioSettingCell')).toHaveText('1:15');
  await expect(target).toHaveText('-- g'); // no bean dose stored yet

  // Target follows the stored bean dose without pressing the beans button
  await page.evaluate(() => window.__test_setMemory({ beans: { weight: 20 } }));
  await expect(target).toHaveText('300.0 g');

  await page.click('#settingsBtn');
  await page.click('#ratioEditBtn');
  await expect(page.locator('#ratioEditBtn')).toHaveText('Save');
  const input = page.locator('#ratioInput');
  for (const bad of ['0', '30.5', '-1', '']) {
    await input.fill(bad);
    await page.click('#ratioEditBtn');
    await expect(page.locator('#ratioError')).toBeVisible();
    await expect(input).toBeVisible(); // still editing
  }
  await input.fill('16.5');
  await expect(page.locator('#ratioError')).toBeHidden(); // typing clears the error
  await input.press('Enter');
  await expect(page.locator('#ratioSettingCell')).toHaveText('1:16.5');
  await expect(page.locator('#ratioEditBtn')).toHaveText('Overwrite');
  await expect(target).toHaveText('330.0 g');
  expect(await page.evaluate(() => localStorage.getItem('brewRatioV1'))).toBe('16.5');

  // Persists across reloads; the target is computed on load
  await page.evaluate(() => localStorage.setItem('scaleMemoryV1', JSON.stringify({ beans: { weight: 18 } })));
  await page.reload();
  await expect(page.locator('#ratioSettingCell')).toHaveText('1:16.5');
  await expect(target).toHaveText('297.0 g');

  // Escape cancels an edit without saving or closing Settings
  await page.click('#settingsBtn');
  await page.click('#ratioEditBtn');
  await page.locator('#ratioInput').fill('20');
  await page.locator('#ratioInput').press('Escape');
  await expect(page.locator('#ratioSettingCell')).toHaveText('1:16.5');
  await expect(page.locator('#settingsModal')).toBeVisible();
});

test('target weight stays when the scale disconnects', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['scale'] }); });
  await page.evaluate(() => toggleConnect());
  await page.evaluate(() => window.__test_setMemory({ beans: { weight: 15 } }));
  await expect(page.locator('#targetWeight')).toHaveText('225.0 g');
  await page.evaluate(() => disconnect());
  await expect(page.locator('#targetWeight')).toHaveText('225.0 g');
});

test('phone layout: chart and cards have 12px side margins; chart labels match their line colours', async ({ page }) => {
  await page.setViewportSize({ width: 384, height: 720 });
  await page.reload();
  await page.evaluate(async () => {
    window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] });
    await toggleConnect();
    await toggleConnect();
  });
  const result = await page.evaluate(() => {
    const card = document.querySelector('.ritual-container').getBoundingClientRect();
    const margins = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return [Math.round(r.left - card.left), Math.round(card.right - r.right)];
    };
    return {
      chart: margins('.brew-chart'),
      cards: margins('.ritual-info'),
      portalCards: margins('#portalInfo'),
      ecLabel: getComputedStyle(document.getElementById('brewChartLabel')).color,
      weightLabel: getComputedStyle(document.querySelector('.brew-chart-label-weight')).color,
    };
  });
  for (const m of [result.chart, result.cards, result.portalCards]) {
    for (const side of m) expect(side).toBeLessThanOrEqual(15);
  }
  expect(result.ecLabel).toBe('rgb(180, 83, 9)'); // #b45309, the EC line
  expect(result.weightLabel).toBe('rgb(141, 110, 99)'); // #8d6e63, the weight line
});
