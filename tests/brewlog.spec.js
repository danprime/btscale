const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');

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

let server;

test.beforeEach(async ({ page }) => {
  const started = await createStaticServer(path.resolve(__dirname, '..'), 0);
  server = started.server;
  // Helpers survive reloads
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
    // Scale + EC meter brew: CIY 2.2 x 100 + 1.1 x 100 = 330, 200 g poured, 2 s on the scale timer
    window.__brew = async () => {
      await window.__emitScale(window.__mock, 0, 0);
      await triStateTimer();
      await window.__emitScale(window.__mock, 100, 1000);
      window.__mock.emitPortal({ ec: 2.2, temp: 25 });
      await window.__emitScale(window.__mock, 200, 2000, 1.5);
      window.__mock.emitPortal({ ec: 1.1, temp: 80 });
      await triStateTimer(); // stop: saved to the log
    };
    window.__logCount = () => window.__test_brewLog.count();
  });
  await page.goto(`http://localhost:${started.port}/index.html`);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__mock?.uninstall());
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

/** Saved settings are read at page load: store them, then reload. */
async function withStorage(page, items) {
  await page.evaluate((items) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
  }, items);
  await page.reload();
}

const cardLabels = (page) => page.locator('#logCards .ritual-info-label').allTextContents();

test('a stopped brew is saved; the calculator updates it; detail shows both charts and all final data', async ({ page }) => {
  await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 20 }, carafe: { weight: 186 } } });
  await page.evaluate(async () => {
    await window.__connect(['scale', 'portal']);
    await window.__brew();
  });
  await expect.poll(() => page.evaluate(() => window.__logCount())).toBe(1);

  await page.click('#settingsBtn');
  await expect(page.locator('#brewLogBtn')).toHaveText('Brew log · 1');
  await page.click('#brewLogBtn');
  await expect(page.locator('#brewLogModal')).toBeVisible();
  await expect(page.locator('#logCount')).toHaveText('1 of 100');
  const item = page.locator('.log-item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.log-item-right')).toHaveText('20g → 160gTDS ≈ 1.03 %'); // estimate at Stop
  await expect(item.locator('.log-item-sub').first()).toContainText('0:02');

  // Calculator: the measured yield and final TDS are saved to the same brew
  await page.locator('#logListView .log-back').click(); // back to Settings
  await page.evaluate(() => closeSettingsModal());
  await page.evaluate(() => window.__emitScale(window.__mock, 336, 2000));
  await page.click('#tareBeanBtn');
  await page.click('#ftNextBtn');
  await expect.poll(() => page.evaluate(async () => (await window.__test_brewLog.list())[0].summary.yield)).toBe(150);
  expect(await page.evaluate(() => window.__logCount())).toBe(1);

  await page.click('#settingsBtn');
  await page.click('#brewLogBtn');
  await expect(item.locator('.log-item-right')).toHaveText('20g → 150gTDS 1.10 %');
  await item.click();
  await expect(page.locator('#logDetailView')).toBeVisible();
  await expect(page.locator('#logBrewChart')).toBeVisible();
  await expect(page.locator('#logBrewChartLabel')).toHaveText('Weight · gEC · mS/cm');
  await expect(page.locator('#logEyChartBox')).toBeVisible();
  await expect(page.locator('#logEyChart .ey-brew')).toHaveCount(1);
  await expect(page.locator('#logEyChart .ey-brew-estimate')).toHaveCount(0); // final, solid
  await expect(page.locator('#logEyChart .ey-trail')).toHaveCount(0);
  expect(await cardLabels(page)).toEqual(['Final weight', 'Time', 'Ratio', 'In → out', 'Avg flow', 'Temp at stop', 'Peak EC', 'CIY', 'Yield', 'TDS', 'Extraction', 'kᵥ']);
  const values = await page.locator('#logCards .ritual-info-value').allTextContents();
  expect(values).toEqual(['200.0 g', '0:02', '1:10.0', '20g → 300g', '100.0 g/s', '80.0 °C', '2.20 mS/cm', '330.0', '150.0 g', '1.10 %', '8.3 %', '0.005']);
  // The brew chart is drawn from the saved points
  await expect(page.locator('#logBrewChart')).toHaveAttribute('aria-label', /EC chart, latest 1\.10 mS\/cm/);
});

test('scale-only brew: only the weight chart and weight numbers', async ({ page }) => {
  await withStorage(page, { scaleMemoryV1: { beans: { weight: 18 } } });
  await page.evaluate(async () => {
    await window.__connect(['scale']);
    await window.__emitScale(window.__mock, 0, 0);
    await triStateTimer();
    await window.__emitScale(window.__mock, 150, 60000, 2.5);
    await window.__emitScale(window.__mock, 270, 120000, 2.0);
    await triStateTimer();
  });
  await expect.poll(() => page.evaluate(() => window.__logCount())).toBe(1);
  await page.click('#settingsBtn');
  await page.click('#brewLogBtn');
  await expect(page.locator('.log-item-right')).toHaveText('18g → 270g'); // no TDS line
  await page.click('.log-item');
  await expect(page.locator('#logBrewChartLabel')).toHaveText('Weight · g');
  await expect(page.locator('#logEyChartBox')).toBeHidden();
  expect(await cardLabels(page)).toEqual(['Final weight', 'Time', 'Ratio', 'In → out', 'Avg flow']);
  expect(await page.locator('#logCards .ritual-info-value').allTextContents()).toEqual(['270.0 g', '2:00', '1:15.0', '18g → 270g', '2.3 g/s']);
});

test('EC-only brew: only the EC chart and EC numbers', async ({ page }) => {
  await page.evaluate(async () => {
    await window.__connect(['portal']);
    await triStateTimer();
    window.__mock.emitPortal({ ec: 2.5, temp: 90 });
    window.__mock.emitPortal({ ec: 1.5, temp: 86 });
    await triStateTimer();
  });
  await expect.poll(() => page.evaluate(() => window.__logCount())).toBe(1);
  await page.click('#settingsBtn');
  await page.click('#brewLogBtn');
  await expect(page.locator('.log-item-right')).toHaveText('Peak EC 2.50');
  await page.click('.log-item');
  await expect(page.locator('#logBrewChartLabel')).toHaveText('EC · mS/cm');
  await expect(page.locator('#logEyChartBox')).toBeHidden();
  expect(await cardLabels(page)).toEqual(['Time', 'Temp at stop', 'Peak EC']);
});

test('nothing recorded: Start/Stop with no readings is not saved', async ({ page }) => {
  await page.evaluate(async () => {
    window.__test_setConnected(true);
    await triStateTimer();
    await triStateTimer();
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__logCount())).toBe(0);
  await page.click('#settingsBtn');
  await expect(page.locator('#brewLogBtn')).toHaveText('Brew log');
  await page.click('#brewLogBtn');
  await expect(page.locator('#logEmpty')).toBeVisible();
});

test('rename (Enter saves, Escape cancels, empty refused) and the date stays', async ({ page }) => {
  await page.evaluate(async () => {
    await window.__connect(['scale']);
    await window.__emitScale(window.__mock, 0, 0);
    await triStateTimer();
    await window.__emitScale(window.__mock, 250, 90000);
    await triStateTimer();
  });
  await expect.poll(() => page.evaluate(() => window.__logCount())).toBe(1);
  await page.click('#settingsBtn');
  await page.click('#brewLogBtn');
  await page.click('.log-item');
  const date = await page.locator('#logDate').textContent();
  await page.click('#logRenameBtn');
  await expect(page.locator('#logRenameBtn')).toHaveText('Save');
  await page.locator('#logNameInput').fill('  ');
  await page.click('#logRenameBtn');
  await expect(page.locator('#logRenameError')).toBeVisible();
  await page.locator('#logNameInput').fill('Kenya AA, V60');
  await page.locator('#logNameInput').press('Enter');
  await expect(page.locator('#logName')).toHaveText('Kenya AA, V60');
  await page.click('#logRenameBtn');
  await page.locator('#logNameInput').fill('Something else');
  await page.locator('#logNameInput').press('Escape');
  await expect(page.locator('#logName')).toHaveText('Kenya AA, V60');
  await expect(page.locator('#logDetailView')).toBeVisible(); // Escape only cancelled the rename

  await page.reload();
  await page.click('#settingsBtn');
  await page.click('#brewLogBtn');
  await expect(page.locator('.log-item-name')).toHaveText('Kenya AA, V60');
  await page.click('.log-item');
  await expect(page.locator('#logDate')).toHaveText(date);
});

test('delete asks first; Escape steps back from detail to list to Settings', async ({ page }) => {
  await page.evaluate(async () => {
    await window.__connect(['scale']);
    for (const w of [200, 220]) {
      await window.__emitScale(window.__mock, 0, 0);
      await triStateTimer();
      await window.__emitScale(window.__mock, w, 60000);
      await triStateTimer();
      await triStateTimer(); // reset
      await new Promise((r) => setTimeout(r, 5)); // distinct start times
    }
  });
  await expect.poll(() => page.evaluate(() => window.__logCount())).toBe(2);
  await page.click('#settingsBtn');
  await expect(page.locator('#brewLogBtn')).toHaveText('Brew log · 2');
  await page.click('#brewLogBtn');
  await expect(page.locator('.log-item-right')).toHaveText(['220g', '200g']); // newest first
  await page.locator('.log-item').first().click();

  await page.click('#logDeleteBtn');
  await expect(page.locator('#logDeleteConfirm')).toBeVisible();
  await page.keyboard.press('Escape'); // cancels the delete
  await expect(page.locator('#logDeleteConfirm')).toBeHidden();
  expect(await page.evaluate(() => window.__logCount())).toBe(2);
  await page.click('#logDeleteBtn');
  await page.click('#logDeleteConfirmBtn');
  await expect(page.locator('#logListView')).toBeVisible();
  await expect(page.locator('.log-item-right')).toHaveText(['200g']);
  await expect(page.locator('#brewLogBtn')).toHaveText('Brew log · 1');

  await page.locator('.log-item').first().click();
  await expect(page.locator('#logDetailView')).toBeVisible();
  await page.keyboard.press('Escape'); // detail -> list
  await expect(page.locator('#logListView')).toBeVisible();
  await page.keyboard.press('Escape'); // list -> Settings
  await expect(page.locator('#brewLogModal')).toBeHidden();
  await expect(page.locator('#settingsModal')).toBeVisible();
});

test('only the latest 100 brews are kept', async ({ page }) => {
  await page.evaluate(async () => {
    for (let i = 1; i <= 100; i++) {
      await window.__test_brewLog.save({ id: i, at: i, name: `old ${i}`, summary: { hasScale: true, hasEc: false, ms: 1000, elapsed: 1, finalWeight: 100, ciy: null }, series: { weight: [], ec: [] } });
    }
    await window.__connect(['scale']);
    await window.__emitScale(window.__mock, 0, 0);
    await triStateTimer();
    await window.__emitScale(window.__mock, 250, 60000);
    await triStateTimer();
  });
  await expect.poll(() => page.evaluate(async () => (await window.__test_brewLog.list())[0].summary.finalWeight)).toBe(250);
  const ids = await page.evaluate(async () => (await window.__test_brewLog.list()).map((b) => b.id));
  expect(ids).toHaveLength(100);
  expect(ids).not.toContain(1); // the oldest went
  expect(ids).toContain(2);
});

test('chart points are downsampled to at most 300 per line', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { downsample } = await import('./brew-log.js');
    const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i, v: i }));
    const d = downsample(pts);
    return { n: d.length, first: d[0].t, last: d[d.length - 1].t, small: downsample(pts.slice(0, 10)).length };
  });
  expect(r).toEqual({ n: 300, first: 0, last: 999, small: 10 });
});

for (const size of [{ width: 384, height: 720 }, { width: 375, height: 667 }]) {
  test(`brew log screens fit a ${size.width}x${size.height} phone`, async ({ page }) => {
    await page.setViewportSize(size);
    await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 20 }, carafe: { weight: 186 } } });
    await page.evaluate(async () => {
      await window.__connect(['scale', 'portal']);
      await window.__brew();
    });
    await expect.poll(() => page.evaluate(() => window.__logCount())).toBe(1);
    await page.click('#settingsBtn');
    await page.click('#brewLogBtn');
    await page.click('.log-item');
    const r = await page.evaluate(() => {
      const c = document.querySelector('#brewLogModal .modal-content');
      const overflow = [...document.querySelectorAll('#logCards .ritual-info-value')].filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent);
      return { sideways: c.scrollWidth - c.clientWidth, width: c.getBoundingClientRect().width, overflow };
    });
    expect(r.sideways).toBeLessThanOrEqual(0);
    expect(r.width).toBeLessThanOrEqual(size.width);
    expect(r.overflow).toEqual([]);
  });
}
