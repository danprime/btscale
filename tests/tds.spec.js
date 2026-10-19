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
    // Emit a BOOKOO weight packet (weight in g)
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
    // Connect the mock devices (one press per device type)
    window.__connect = async (devices) => {
      window.__mock = window.__test_installMultiBLEMock({ devices });
      for (let i = 0; i < devices.length; i++) await toggleConnect();
    };
    // A short brew with a known CIY: 220 + 1.1/(1 + 0.02 x 55) x 100 = 272.38
    window.__brew = async () => {
      await window.__emitScale(window.__mock, 0, 0);
      await triStateTimer(); // start
      await window.__emitScale(window.__mock, 100, 1000);
      window.__mock.emitPortal({ ec: 2.2, temp: 25 });
      await window.__emitScale(window.__mock, 200, 2000);
      window.__mock.emitPortal({ ec: 1.1, temp: 80 });
    };
  });
  await page.goto(`http://localhost:${started.port}/index.html`);
});

/** Saved settings are read at page load: store them, then reload. */
async function withStorage(page, items) {
  await page.evaluate((items) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
  }, items);
  await page.reload();
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__mock?.uninstall());
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

test('TDS maths: EC at 25 °C, CIY over poured water, TDS and k_v', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const m = await import('./tds.js');
    const c = new m.CiyIntegrator();
    c.reset(0);
    c.addWeight(50); c.addEc(2, 25); // +2 x 50
    c.addWeight(40); c.addEc(2, 25); // weight dipped: nothing added
    c.addWeight(100); c.addEc(3, 85); // only the 50 g above the previous high counts
    const late = new m.CiyIntegrator();
    late.addWeight(30); late.addEc(2, 25); late.addWeight(40); late.addEc(2, 25); // first weight is the baseline
    return {
      ec25: m.ec25(3, 85), ec25NoTemp: m.ec25(3, null),
      ciy: c.ciy, poured: c.poured, lateCiy: late.ciy, latePoured: late.poured,
      yield: m.liveYield(300, 20, 2), yieldNoDose: m.liveYield(300, null, 2),
      tds: m.tdsPercent(0.005, 700, 258), tdsNoKv: m.tdsPercent(null, 700, 258), tdsNoYield: m.tdsPercent(0.005, 700, -5),
      kv: m.calcKv(1.38, 258, 700),
    };
  });
  expect(r.ec25).toBeCloseTo(3 / 2.2, 10);
  expect(r.ec25NoTemp).toBe(3);
  expect(r.ciy).toBeCloseTo(100 + (3 / 2.2) * 50, 10);
  expect(r.poured).toBe(100);
  expect(r.lateCiy).toBe(20);
  expect(r.latePoured).toBe(10);
  expect(r.yield).toBe(260);
  expect(r.yieldNoDose).toBe(300);
  expect(r.tds).toBeCloseTo((100 * 0.005 * 700) / 258, 10);
  expect(r.tdsNoKv).toBeNull();
  expect(r.tdsNoYield).toBeNull();
  expect(r.kv).toBeCloseTo((1.38 * 258) / (100 * 700), 10);
});

test('live TDS needs the scale and the EC meter, waits 30 s, then uses the live yield', async ({ page }) => {
  const panel = page.locator('#tdsPanel');
  await page.evaluate(() => window.__connect(['scale']));
  await expect(panel).toBeHidden();
  await page.evaluate(() => disconnect());
  await page.evaluate(() => { window.__mock.uninstall(); return window.__connect(['portal']); });
  await expect(panel).toBeHidden();
  await page.evaluate(() => disconnect());

  await page.evaluate(() => { window.__mock.uninstall(); return window.__connect(['scale', 'portal']); });
  await expect(panel).toBeVisible();
  await expect(page.locator('#tdsLabel')).toHaveText('TDS ≈ (uncal.)'); // default k_v until calibrated
  await expect(page.locator('#tdsValue')).toHaveText('-- %');
  // Temperature, TDS, EC in one row
  const labels = await page.locator('#portalInfo .ritual-info-item:visible .ritual-info-label').allTextContents();
  expect(labels).toEqual(['Temperature', 'TDS ≈ (uncal.)', 'EC']);

  await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 20 } } });
  await page.evaluate(() => window.__connect(['scale', 'portal']));
  await expect(page.locator('#tdsValue')).toHaveText('-- %');
  await page.evaluate(() => window.__brew());
  await expect(page.locator('#tdsValue')).toHaveText('-- %'); // first 30 s
  await page.evaluate(() => window.__test_setTdsDelay(0));
  // 100 x 0.005 x 272.38 / (200 - 20 x 2.0) = 0.85
  await expect(page.locator('#tdsValue')).toHaveText('0.85 %');

  // Bed absorption changes the live yield: 200 - 20 x 1.5 = 170 g -> 0.80 %
  await page.click('#settingsBtn');
  await page.click('#absorptionEditBtn');
  await page.locator('#absorptionInput').fill('1.5');
  await page.locator('#absorptionInput').press('Enter');
  await expect(page.locator('#tdsValue')).toHaveText('0.80 %');
});

test('after Stop: CIY replaces EC, M_B becomes the calculator; Next shows the final TDS and the yield', async ({ page }) => {
  await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 20 }, carafe: { weight: 186 } } });
  await page.evaluate(async () => {
    await window.__connect(['scale', 'portal']);
    await window.__brew();
  });
  const bean = page.locator('#tareBeanBtn');
  await expect(bean).toHaveAttribute('aria-label', 'Set beans');
  await page.evaluate(() => triStateTimer()); // stop
  await expect(page.locator('#ecLabel')).toHaveText('CIY');
  await expect(page.locator('#ecValue')).toHaveText('272.4');
  await expect(page.locator('#tdsLabel')).toHaveText('TDS ≈');
  await expect(page.locator('#tdsValue')).toHaveText('0.85 %'); // estimate at stop
  await expect(bean).toHaveAttribute('aria-label', 'Final TDS calculator');
  await expect(page.locator('#yieldPanel')).toBeHidden();

  // Carafe on the scale; opening the calculator does not tare
  await page.evaluate(() => window.__emitScale(window.__mock, 336, 2000));
  const writesBefore = await page.evaluate(() => window.__mock.scaleCommandWrites().length);
  await bean.click();
  await expect(page.locator('#finalTdsModal')).toBeVisible();
  expect(await page.evaluate(() => window.__mock.scaleCommandWrites().length)).toBe(writesBefore);
  await expect(page.locator('#ftScale')).toHaveText('336.0 g');
  await expect(page.locator('#ftCarafe')).toHaveText('186.0 g');
  await expect(page.locator('#ftYield')).toHaveValue('150.0'); // scale - carafe
  await expect(page.locator('#ftCiy')).toHaveText('272.4');
  await expect(page.locator('#ftTds')).toHaveText('0.91 %');
  await expect(page.locator('#finalTdsModal math')).toHaveCount(1);

  // The yield follows the scale until it is edited
  await page.evaluate(() => window.__emitScale(window.__mock, 337, 2000));
  await expect(page.locator('#ftYield')).toHaveValue('151.0');
  await page.locator('#ftYield').fill('150');
  await page.evaluate(() => window.__emitScale(window.__mock, 340, 2000));
  await expect(page.locator('#ftYield')).toHaveValue('150');
  await expect(page.locator('#ftTds')).toHaveText('0.91 %');

  // Tare is a separate button
  await page.click('#ftTareBtn');
  expect(await page.evaluate(() => window.__mock.scaleCommandWrites().length)).toBe(writesBefore + 1);

  // A bad yield is refused
  await page.locator('#ftYield').fill('0');
  await page.click('#ftNextBtn');
  await expect(page.locator('#ftError')).toBeVisible();
  await page.locator('#ftYield').fill('150');
  await page.click('#ftNextBtn');
  await expect(page.locator('#finalTdsModal')).toBeHidden();
  await expect(page.locator('#tdsLabel')).toHaveText('TDS');
  await expect(page.locator('#tdsValue')).toHaveText('0.91 %');
  await expect(page.locator('#yieldPanel')).toBeVisible();
  await expect(page.locator('#yieldValue')).toHaveText('150.0 g');
  const brew = await page.evaluate(() => JSON.parse(localStorage.getItem('lastBrewV1')));
  expect(brew.ciy).toBeCloseTo(272.381, 3);
  expect(brew.yield).toBe(150);
  expect(brew.estYield).toBe(160);

  // Reset: back to the live view
  await page.evaluate(() => triStateTimer());
  await expect(bean).toHaveAttribute('aria-label', 'Set beans');
  await expect(page.locator('#ecLabel')).toHaveText('EC');
  await expect(page.locator('#yieldPanel')).toBeHidden();
  await expect(page.locator('#tdsLabel')).toHaveText('TDS ≈');
});

test('EC meter only: no TDS, Peak EC after Stop and M_B stays Set beans', async ({ page }) => {
  await page.evaluate(async () => {
    await window.__connect(['portal']);
    await triStateTimer();
    window.__mock.emitPortal({ ec: 2.5, temp: 90 });
    await triStateTimer();
  });
  await expect(page.locator('#tdsPanel')).toBeHidden();
  await expect(page.locator('#ecLabel')).toHaveText('Peak EC');
  await expect(page.locator('#tareBeanBtn')).toHaveAttribute('aria-label', 'Set beans');
  await expect(page.locator('#tareBeanBtn')).toBeDisabled();
});

test('settings: bed absorption and k_v under Ratio (default 2.0), Calibrate, no TDS header or target hint', async ({ page }) => {
  await page.click('#settingsBtn');
  const rows = await page.locator('#memoryTable tbody tr td:first-child').allTextContents();
  expect(rows).toEqual(['Bean Dose', 'Carafe/Server', 'Ratio', 'Bed absorption', 'kv']);
  await expect(page.locator('#settingsModal h3', { hasText: 'TDS' })).toHaveCount(0);
  await expect(page.locator('#absorptionSettingCell')).toHaveText('2.0 g/g');
  await expect(page.locator('#kvSettingValue')).toHaveText('0.005uncalibrated'); // default until calibrated
  await expect(page.locator('#kvSettingValue .kv-uncalibrated')).toBeVisible();
  await expect(page.locator('#kvCalibrateBtn')).toHaveText('Calibrate');
  await expect(page.locator('.setting-hint')).toHaveCount(0);

  await page.click('#absorptionEditBtn');
  await expect(page.locator('#absorptionEditBtn')).toHaveText('Save');
  for (const bad of ['-1', '5.5', '']) {
    await page.locator('#absorptionInput').fill(bad);
    await page.click('#absorptionEditBtn');
    await expect(page.locator('#absorptionError')).toBeVisible();
  }
  await page.locator('#absorptionInput').fill('2.15');
  await page.click('#absorptionEditBtn');
  await expect(page.locator('#absorptionSettingCell')).toHaveText('2.15 g/g');
  expect(await page.evaluate(() => localStorage.getItem('bedAbsorptionV1'))).toBe('2.15');
  await page.reload();
  await expect(page.locator('#absorptionSettingCell')).toHaveText('2.15 g/g');
});

test('calibration: asks for a brew first, then TDS % -> k_v live -> compare, edit and save', async ({ page }) => {
  await page.click('#settingsBtn');
  await page.click('#kvCalibrateBtn');
  await expect(page.locator('#calEmpty')).toBeVisible();
  await expect(page.locator('#calEmpty')).toContainText('Brew a full cup with the scale and EC meter connected');
  await page.locator('#calEmpty button').click();
  await expect(page.locator('#calibrateModal')).toBeHidden();

  await withStorage(page, {
    lastBrewV1: { ciy: 272.381, estYield: 160, yield: 150, at: Date.now() },
    tdsKvV1: 0.005,
    kvHistoryV1: [{ at: 3, kv: 0.0071 }, { at: 2, kv: 0.0074 }, { at: 1, kv: 0.0080 }],
  });
  await page.click('#settingsBtn');
  await page.click('#kvCalibrateBtn');
  await expect(page.locator('#calStep1')).toBeVisible();
  await expect(page.locator('#calCiy')).toHaveText('272.4');
  await expect(page.locator('#calYield')).toHaveValue('150.0'); // measured yield from the calculator
  await expect(page.locator('#calKv')).toHaveText('--');
  await expect(page.locator('#calStep1 math')).toHaveCount(1);

  // TDS must be a percentage
  await page.locator('#calTds').fill('0.0138');
  await expect(page.locator('#calKv')).toHaveText('--');
  await page.click('#calNextBtn');
  await expect(page.locator('#calError')).toContainText('percentage');
  await page.locator('#calTds').fill('1.38');
  await expect(page.locator('#calError')).toBeHidden();
  // k_v = 1.38 x 150 / (100 x 272.381) = 0.0076, recalculated as the yield changes
  await expect(page.locator('#calKv')).toHaveText('0.0076');
  await page.locator('#calYield').fill('160');
  await expect(page.locator('#calKv')).toHaveText('0.008106');
  await page.locator('#calYield').fill('150');
  await page.click('#calNextBtn');

  await expect(page.locator('#calStep2')).toBeVisible();
  await expect(page.locator('#calCurrentKv')).toHaveText('0.005');
  await expect(page.locator('#calNewKv')).toHaveValue('0.0076');
  const history = await page.locator('#calHistoryRows tr td:last-child').allTextContents();
  expect(history).toEqual(['0.0071', '0.0074', '0.008', '0.0075']); // newest first, then the average

  // Save an edited value: it becomes k_v and goes into the history (newest first, 3 kept)
  await page.locator('#calNewKv').fill('0.0077');
  await page.click('#calSaveBtn');
  await expect(page.locator('#calibrateModal')).toBeHidden();
  await expect(page.locator('#settingsModal')).toBeVisible();
  await expect(page.locator('#kvSettingValue')).toHaveText('0.0077');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kvHistoryV1')).map((e) => e.kv))).toEqual([0.0077, 0.0071, 0.0074]);

  // Keep current: k_v unchanged, the calculated value still goes into the history
  await page.click('#kvCalibrateBtn');
  await page.locator('#calTds').fill('1.38');
  await page.click('#calNextBtn');
  await page.locator('#calStep2 button', { hasText: 'Keep current' }).click();
  await expect(page.locator('#kvSettingValue')).toHaveText('0.0077');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kvHistoryV1'))[0].kv)).toBeCloseTo(0.0076, 4);

  // Escape closes only the calibration dialog
  await page.click('#kvCalibrateBtn');
  await page.keyboard.press('Escape');
  await expect(page.locator('#calibrateModal')).toBeHidden();
  await expect(page.locator('#settingsModal')).toBeVisible();
});

test('CSV has EC at 25 °C, CIY and TDS columns at the end', async ({ page }) => {
  await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 20 } } });
  await page.evaluate(async () => {
    await window.__connect(['scale', 'portal']);
    await window.__brew();
    await triStateTimer();
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsvBtn')]);
  const csv = fs.readFileSync(await download.path(), 'utf8').trim().split('\n');
  expect(csv[0]).toBe('t_s,weight_g,flow_gps,temp_c,ec_mScm,source,ec25_mScm,ciy,tds_pct');
  const last = csv[csv.length - 1].split(',');
  expect(last[5]).toBe('portal');
  expect(last.slice(6)).toEqual(['0.524', '272.38', '0.851']);
});

for (const size of [{ width: 384, height: 720 }, { width: 375, height: 667 }]) {
  test(`TDS screens fit a ${size.width}x${size.height} phone`, async ({ page }) => {
    await page.setViewportSize(size);
    await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 20 }, carafe: { weight: 186 } } });
    await page.evaluate(async () => {
      await window.__connect(['scale', 'portal']);
      await window.__brew();
      await triStateTimer();
      await window.__emitScale(window.__mock, 336, 2000);
    });
    await page.click('#tareBeanBtn');
    await page.click('#ftNextBtn');
    const dims = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      view: innerHeight,
      overflow: [...document.querySelectorAll('.ritual-info-value')].filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth).map((el) => el.id),
    }));
    expect(dims.doc).toBe(dims.view); // no page scroll with the Yield panel added
    expect(dims.overflow).toEqual([]);
    // The dialogs fit the screen
    await page.click('#tareBeanBtn');
    const box = await page.locator('#finalTdsModal .modal-content').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  });
}

test('extraction yield and region maths', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const m = await import('./tds.js');
    return {
      ey: m.extractionYield(258, 1.33, 20), eyNoDose: m.extractionYield(258, 1.33, null),
      gold: m.extractionRegion(1.25, 20), strongUnder: m.extractionRegion(1.5, 16), strongOver: m.extractionRegion(1.5, 24),
      weakUnder: m.extractionRegion(0.9, 16), weakOver: m.extractionRegion(0.9, 24), edge: m.extractionRegion(1.35, 22),
    };
  });
  expect(r.ey).toBeCloseTo(17.157, 3);
  expect(r.eyNoDose).toBeNull();
  expect(r.gold).toBe('Ideal (gold cup)');
  expect(r.strongUnder).toBe('Strong / under-extracted');
  expect(r.strongOver).toBe('Strong / over-extracted');
  expect(r.weakUnder).toBe('Weak / under-extracted');
  expect(r.weakOver).toBe('Weak / over-extracted');
  expect(r.edge).toBe('Ideal (gold cup)'); // the zone includes its edges
});

test('after Stop the chart becomes a carousel: estimate (hollow), tap for labels, Next switches to a solid point', async ({ page }) => {
  await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 20 }, carafe: { weight: 186 } } });
  await page.evaluate(async () => {
    await window.__connect(['scale', 'portal']);
    await window.__brew();
  });
  const slide = page.locator('#extractionSlide');
  const dots = page.locator('#chartDots');
  const track = page.locator('#chartTrack');
  await expect(slide).toBeHidden(); // while brewing: brew chart only
  await expect(dots).toBeHidden();

  await page.evaluate(() => triStateTimer()); // stop
  await expect(slide).toBeAttached();
  await expect(dots).toBeVisible();
  expect(await track.evaluate((t) => t.scrollLeft)).toBe(0); // stays on the brew chart at Stop
  // Estimate: 160 g x 0.85 % / 20 g = 6.8 % extraction, pinned to the left edge, hollow
  await expect(page.locator('.ey-brew.ey-brew-estimate')).toHaveCount(1);
  await expect(page.locator('#extractionChart')).toHaveAttribute('aria-label', /estimated extraction 6\.8 %, TDS 0\.85 %: Weak \/ under-extracted/);
  await expect(page.locator('.ey-brew-label')).toHaveText('≈ 6.8 %, 0.85 %');
  // No gold cup label or ideal dot; region labels hidden until a tap
  expect(await page.locator('#extractionChart').textContent()).not.toMatch(/Gold|Ideal/);
  await expect(page.locator('.ey-ref')).toHaveCount(4);
  await expect(page.locator('.ey-label')).toHaveCount(0);

  await page.click('#chartDots .chart-dot >> nth=1');
  await expect.poll(() => track.evaluate((t) => Math.round(t.scrollLeft / t.clientWidth))).toBe(1);
  await page.click('#extractionChart');
  await expect(page.locator('.ey-label')).toHaveCount(4);
  await expect(page.locator('.ey-label >> nth=0').locator('tspan')).toHaveText(['Strong & Sour', '(Thick/Muddy)']);
  await expect(page.locator('.ey-brew-label')).toHaveCount(0); // region labels take over; the dot stays
  await expect(page.locator('.ey-brew')).toHaveCount(1);
  await page.click('#extractionChart');
  await expect(page.locator('.ey-label')).toHaveCount(0);

  // Calculator Next: measured point (solid) and the carousel shows the extraction chart
  await page.click('#chartDots .chart-dot >> nth=0');
  await expect.poll(() => track.evaluate((t) => Math.round(t.scrollLeft / t.clientWidth))).toBe(0);
  await page.evaluate(() => window.__emitScale(window.__mock, 336, 2000));
  await page.click('#tareBeanBtn');
  await page.click('#ftNextBtn');
  await expect.poll(() => track.evaluate((t) => Math.round(t.scrollLeft / t.clientWidth))).toBe(1);
  await expect(page.locator('#chartDots .chart-dot >> nth=1')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.ey-brew-estimate')).toHaveCount(0);
  // 150 g x 0.908 % / 20 g = 6.8 %
  await expect(page.locator('.ey-brew-label')).toHaveText('6.8 %, 0.91 %');

  // Reset: back to the brew chart alone
  await page.evaluate(() => triStateTimer());
  await expect(slide).toBeHidden();
  await expect(dots).toBeHidden();
  expect(await track.evaluate((t) => t.scrollLeft)).toBe(0);
});

test('no carousel after an EC-only brew', async ({ page }) => {
  await page.evaluate(async () => {
    await window.__connect(['portal']);
    await triStateTimer();
    window.__mock.emitPortal({ ec: 2.5, temp: 90 });
    await triStateTimer();
  });
  await expect(page.locator('#extractionSlide')).toBeHidden();
  await expect(page.locator('#chartDots')).toBeHidden();
});

test('default k_v 0.005 is used and marked uncalibrated until a k_v is saved', async ({ page }) => {
  await withStorage(page, { scaleMemoryV1: { beans: { weight: 20 }, carafe: { weight: 186 } } });
  await page.evaluate(async () => {
    await window.__connect(['scale', 'portal']);
    await window.__brew();
    window.__test_setTdsDelay(0);
  });
  // Same numbers as with a stored 0.005, but marked
  await expect(page.locator('#tdsLabel')).toHaveText('TDS ≈ (uncal.)');
  await expect(page.locator('#tdsValue')).toHaveText('0.85 %');
  await page.evaluate(() => triStateTimer()); // stop
  await expect(page.locator('#tdsLabel')).toHaveText('TDS ≈ (uncal.)');
  await expect(page.locator('.ey-brew')).toHaveCount(1); // plotted with the default
  await page.evaluate(() => window.__emitScale(window.__mock, 336, 2000));
  await page.click('#tareBeanBtn');
  await expect(page.locator('#ftTds')).toHaveText('0.91 % · uncalibrated');
  await page.click('#ftNextBtn');
  await expect(page.locator('#tdsLabel')).toHaveText('TDS (uncal.)');
  await expect(page.locator('#tdsValue')).toHaveText('0.91 %');

  // Calibrating clears the marks
  await page.click('#settingsBtn');
  await page.click('#kvCalibrateBtn');
  await page.locator('#calTds').fill('1.38');
  await page.click('#calNextBtn');
  await expect(page.locator('#calCurrentKv')).toHaveText('0.005 (uncalibrated)');
  await page.click('#calSaveBtn');
  await expect(page.locator('#kvSettingValue')).toHaveText('0.0076');
  await expect(page.locator('#tdsLabel')).toHaveText('TDS');
});

test('target card "in → out" stays on one line next to the Yield card', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await withStorage(page, { tdsKvV1: 0.005, scaleMemoryV1: { beans: { weight: 18.5 }, carafe: { weight: 186 } } });
  const target = page.locator('#targetWeight');
  await expect(target).toHaveText('18.5gin → 277.5gout');
  await page.evaluate(async () => {
    await window.__connect(['scale', 'portal']);
    await window.__brew();
    await triStateTimer();
    await window.__emitScale(window.__mock, 336, 2000);
  });
  await page.click('#tareBeanBtn');
  await page.click('#ftNextBtn');
  await expect(page.locator('#yieldPanel')).toBeVisible();
  await expect.poll(() => target.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height < 30)).toBe(true);
});
