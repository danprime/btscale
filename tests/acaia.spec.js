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
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__mock?.uninstall());
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

test('Acaia packets: encode, decode and reject damaged ones', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const m = await import('./acaia-protocol.js');
    const tare = m.encodeTare(3);
    const w = m.encode(5, [0x3a, 0x04, 0, 0, 1, 0, 0], 9);
    const neg = m.encode(5, [0x3a, 0x04, 0, 0, 1, 0, 2], 200);
    const bad = Uint8Array.from(w); bad[bad.length - 1] ^= 1;
    return {
      tare: Array.from(tare),
      weight: m.decode(w).weight,
      negative: m.decode(neg).weight,
      bad: m.decode(bad),
      short: m.decode(new Uint8Array(3)),
    };
  });
  expect(r.tare.slice(0, 7)).toEqual([0xdf, 0x78, 7, 12, 3, 0, 2]);
  expect(r.weight).toBeCloseTo(108.2, 5);
  expect(r.negative).toBeCloseTo(-108.2, 5);
  expect(r.bad).toBeNull();
  expect(r.short).toBeNull();
});

test('an Acaia scale connects, shows weight and takes tare and timer commands', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['acaia'] }); });
  await expect(page.locator('#scaleIcon')).toHaveAttribute('data-connected', 'false');
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toHaveAttribute('data-connected', 'true');

  // It asks for weight as soon as it connects
  expect(await page.evaluate(() => window.__mock.acaiaWrites().length)).toBeGreaterThan(0);

  await page.evaluate(() => window.__mock.emitAcaiaWeight(150.2));
  await expect(page.locator('#weightDisplay')).toHaveText('150.2');

  const before = await page.evaluate(() => window.__mock.acaiaWrites().length);
  await page.evaluate(() => window.__scaleController.tare());
  await page.evaluate(() => window.__scaleController.startTimer());
  const writes = await page.evaluate((n) => window.__mock.acaiaWrites().slice(n), before);
  expect(writes.map((w) => w[3])).toEqual([12, 12]); // two "custom" commands
  expect(writes[0].length).toBe(10); // tare: 8 bytes of framing + 2 payload bytes
  expect(writes[1].length).toBe(9);  // start timer has a one-byte payload

  // Settings the scale cannot do are refused, not silently ignored
  const msg = await page.evaluate(() => window.__scaleController.setBeep(2).then(() => 'ok', (e) => e.message));
  expect(msg).toMatch(/not supported/);

  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toHaveAttribute('data-connected', 'false');
});

test('with an Acaia scale and the EC meter, one picker lists both brands of scale', async ({ page }) => {
  await page.evaluate(() => { window.__mock = window.__test_installMultiBLEMock({ devices: ['acaia', 'portal'] }); });
  await page.evaluate(() => toggleConnect());
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toHaveAttribute('data-connected', 'true');
  await expect(page.locator('#portalIcon')).toHaveAttribute('data-connected', 'true');
  const filters = await page.evaluate(() => window.__mock.mock.requests[0].filters);
  expect(filters.length).toBe(3);
});

test('a remembered Acaia scale reconnects without the picker', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('bleDeviceIdsV1', JSON.stringify({ scale: 'mock-acaia-id' }));
    window.__mock = window.__test_installMultiBLEMock({ devices: ['acaia'], permitted: ['acaia'] });
  });
  await page.evaluate(() => toggleConnect());
  await expect(page.locator('#scaleIcon')).toHaveAttribute('data-connected', 'true');
  // Only the EC meter, which was never remembered, is looked for in a picker
  const requests = await page.evaluate(() => window.__mock.mock.requests.map((r) => r.filters));
  expect(requests).toEqual([[{ name: 'BelkaPortal' }]]);
  await page.evaluate(() => window.__mock.emitAcaiaWeight(20));
  await expect(page.locator('#weightDisplay')).toHaveText('20.0');
});
