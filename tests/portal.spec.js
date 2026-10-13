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
