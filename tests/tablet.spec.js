const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Tablet landscape (iPad): thirds layout, all nine readings, both charts, Settings panel, brew log list + detail

function createStaticServer(root, port = 0) {
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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

const IPAD_12 = { width: 1366, height: 930 }; // 12.9" landscape, minus the browser toolbar
const IPAD_11 = { width: 1194, height: 760 }; // 11" landscape, minus the browser toolbar

let server;

test.beforeEach(async ({ page }) => {
  const started = await createStaticServer(path.resolve(__dirname, '..'), 0);
  server = started.server;
  await page.setViewportSize(IPAD_12);
  await page.addInitScript(() => {
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
    window.__connect = async (devices) => {
      window.__mock = window.__test_installMultiBLEMock({ devices });
      for (let i = 0; i < devices.length; i++) await toggleConnect();
    };
    // CIY = 2.2 x 100 + 1.1 x 100 = 330; 200 g poured
    window.__brew = async () => {
      window.__test_setTdsDelay(0);
      await window.__emitScale(window.__mock, 0, 0);
      await triStateTimer(); // start
      await window.__emitScale(window.__mock, 100, 1000);
      window.__mock.emitPortal({ ec: 2.2, temp: 90 });
      await window.__emitScale(window.__mock, 200, 2000);
      window.__mock.emitPortal({ ec: 1.1, temp: 88 });
    };
  });
  await page.goto(`http://localhost:${started.port}/index.html`);
  // Bean dose 20 g, carafe 186 g
  await page.evaluate(() => localStorage.setItem('scaleMemoryV1', JSON.stringify({ beans: { weight: 20 }, carafe: { weight: 186 } })));
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__mock?.uninstall());
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

/** Visible readings, in reading order (rows top to bottom, then left to right). */
const readingOrder = (page) => page.evaluate(() => [...document.querySelectorAll('#readings .ritual-info-item')]
  .filter((el) => el.offsetParent !== null)
  .map((el) => ({ id: el.id, r: el.getBoundingClientRect() }))
  .sort((a, b) => Math.round(a.r.top) - Math.round(b.r.top) || a.r.left - b.r.left)
  .map((e) => e.id));

const NINE = ['flowPanel', 'targetPanel', 'remainderPanel', 'tdsPanel', 'eyPanel', 'yieldPanel', 'tempPanel', 'ecPanel', 'ciyPanel'];

for (const [name, size] of [['12.9"', IPAD_12], ['11"', IPAD_11]]) {
  test(`iPad ${name} landscape: weight and readings in the left third, charts in the right two thirds, no scrolling`, async ({ page }) => {
    await page.setViewportSize(size);
    const r = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect();
      return {
        third: window.innerWidth / 3,
        hero: box('.ritual-hero'),
        readings: box('#readings'),
        controls: box('.ritual-main-actions'),
        chart: box('.brew-chart'),
        scrolls: document.documentElement.scrollHeight > window.innerHeight,
      };
    });
    expect(r.scrolls).toBe(false);
    for (const b of [r.hero, r.readings, r.controls]) expect(b.right).toBeLessThanOrEqual(r.third + 1);
    expect(r.chart.left).toBeGreaterThanOrEqual(r.third - 1);
    // Weight on top, readings below it, buttons at the bottom
    expect(r.hero.bottom).toBeLessThanOrEqual(r.readings.top);
    expect(r.readings.bottom).toBeLessThanOrEqual(r.controls.top);
    // Nothing connected: all nine readings, three to a row, in their fixed order
    expect(await readingOrder(page)).toEqual(NINE);
    await expect(page.locator('#eyValue')).toHaveText('-- %');
    await expect(page.locator('#ciyValue')).toHaveText('--');
  });
}

test('tablet: one chart with only the scale; both charts (stacked, no tabs) during a TDS brew', async ({ page }) => {
  await page.evaluate(() => window.__connect(['scale']));
  await expect(page.locator('#extractionSlide')).toBeHidden();
  await page.evaluate(async () => { await disconnect(); await window.__connect(['scale', 'portal']); await window.__brew(); });
  await expect(page.locator('#extractionSlide')).toBeVisible();
  await expect(page.locator('#chartDots')).toBeHidden(); // both charts are on screen: no tabs
  const [brew, ey] = await page.evaluate(() => ['#brewChartCanvas', '#extractionChart'].map((s) => document.querySelector(s).getBoundingClientRect().toJSON()));
  expect(ey.top).toBeGreaterThan(brew.bottom); // stacked
  expect(Math.round(ey.width)).toBe(Math.round(brew.width));
  // Bigger axis text and floating values on the brew chart
  const css = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('brewChartCanvas'));
    return [cs.getPropertyValue('--chart-font').trim(), cs.getPropertyValue('--chart-values').trim()];
  });
  expect(css).toEqual(['14px', '1']);
});

test('tablet: Extraction, CIY and the live yield have readings; Remaining counts down to the target', async ({ page }) => {
  await page.evaluate(async () => { await window.__connect(['scale', 'portal']); await window.__brew(); });
  await expect(page.locator('#ciyValue')).toHaveText('330.0');
  await expect(page.locator('#yieldLabel')).toHaveText('Yield ≈');
  await expect(page.locator('#yieldValue')).toHaveText('160.0 g'); // 200 poured - 20 g x 2.0
  await expect(page.locator('#eyLabel')).toHaveText('Extraction ≈');
  await expect(page.locator('#eyValue')).toHaveText(/^\d+\.\d %$/);
  await expect(page.locator('#remainder')).toHaveText('100.0 g'); // target 300 g
  // After Stop the EC reading shows the peak; CIY keeps its own reading
  await page.evaluate(() => triStateTimer());
  await expect(page.locator('#ecLabel')).toHaveText('Peak EC');
  await expect(page.locator('#ciyValue')).toHaveText('330.0');
});

test('tablet: Settings slides in at the right edge; calibration opens inside it', async ({ page }) => {
  await page.click('#settingsBtn');
  const sheet = await page.locator('#settingsModal .settings-sheet').boundingBox();
  expect(Math.round(sheet.x + sheet.width)).toBe(IPAD_12.width);
  expect(Math.round(sheet.width)).toBe(480);
  await page.click('#kvCalibrateBtn');
  const cal = await page.locator('#calibrateModal .modal-content').boundingBox();
  expect(Math.round(cal.x)).toBe(Math.round(sheet.x));
  expect(Math.round(cal.width)).toBe(480);
});

test('tablet: the brew log shows the list beside the open brew; tapping another brew switches it', async ({ page }) => {
  await page.evaluate(async () => {
    const brew = (id, name, finalWeight) => ({ id, at: id, name, summary: { hasScale: true, hasEc: false, ms: 180000, elapsed: 180, finalWeight, dose: 20, ciy: null }, series: { weight: [{ t: 0, v: 0 }, { t: 180, v: finalWeight }], ec: [] } });
    await window.__test_brewLog.save(brew(Date.now() - 86400000, 'Older brew', 250));
    await window.__test_brewLog.save(brew(Date.now(), 'Newest brew', 300));
  });
  await page.click('#settingsBtn');
  await page.click('#brewLogBtn');
  await expect(page.locator('#logListView')).toBeVisible();
  await expect(page.locator('#logDetailView')).toBeVisible();
  await expect(page.locator('#logName')).toHaveText('Newest brew');
  await expect(page.locator('#logList .log-item.is-selected .log-item-name')).toHaveText('Newest brew');
  await expect(page.locator('#logDetailView .log-back')).toBeHidden(); // the list is beside it
  // Side by side: the list in the left third, the brew in the right two thirds
  const [list, detail] = await page.evaluate(() => ['#logListView', '#logDetailView'].map((s) => document.querySelector(s).getBoundingClientRect().toJSON()));
  expect(list.right).toBeLessThanOrEqual(IPAD_12.width / 3 + 1);
  expect(detail.left).toBeGreaterThanOrEqual(IPAD_12.width / 3 - 1);
  await page.locator('#logList .log-item', { hasText: 'Older brew' }).click();
  await expect(page.locator('#logName')).toHaveText('Older brew');
  await expect(page.locator('#logList .log-item.is-selected .log-item-name')).toHaveText('Older brew');
  // Escape closes the log (there is no separate list view to go back to)
  await page.keyboard.press('Escape');
  await expect(page.locator('#brewLogModal')).toBeHidden();
});

test('rotating to portrait leaves the tablet layout; the phone never shows the tablet-only readings', async ({ page }) => {
  await expect(page.locator('#eyPanel')).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 1366 }); // portrait
  await expect(page.locator('#eyPanel')).toBeHidden();
  await expect(page.locator('#ciyPanel')).toBeHidden();
  await expect(page.locator('#remainderPanel')).toBeHidden();
  await page.setViewportSize({ width: 384, height: 720 }); // phone
  await expect(page.locator('#eyPanel')).toBeHidden();
  await expect(page.locator('#portalInfo')).toBeHidden(); // EC meter readings only when it is connected
  await page.setViewportSize(IPAD_12); // and back
  await expect(page.locator('#eyPanel')).toBeVisible();
  expect(await readingOrder(page)).toEqual(NINE);
});
