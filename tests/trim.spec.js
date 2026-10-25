const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Trim: after Stop, move the end of the brew earlier (Stop was pressed late). Optional.

function createStaticServer(root) {
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/index.html';
    fs.readFile(path.join(root, pathname), (err, data) => {
      if (err) { res.statusCode = 404; res.end('Not found'); return; }
      const map = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', map[path.extname(pathname).toLowerCase()] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let server;

test.beforeEach(async ({ page }) => {
  server = await createStaticServer(path.resolve(__dirname, '..'));
  await page.setViewportSize({ width: 384, height: 720 });
  await page.addInitScript(() => {
    // A brew where Stop came late: last pour ends at 3:48 (304 g), drawdown to 4:12,
    // the dripper is lifted (180 g on the scale), Stop at 4:42. One reading every 3 s.
    window.__lateStopBrew = async ({ stop = true } = {}) => {
      const emit = async (weight, ms) => {
        const b = new Uint8Array(20); b[0] = 3; b[1] = 0x0B; b[2] = (ms >> 16) & 255; b[3] = (ms >> 8) & 255; b[4] = ms & 255;
        const w = Math.round(weight * 100); b[7] = (w >> 16) & 255; b[8] = (w >> 8) & 255; b[9] = w & 255; b[12] = 200; b[13] = 80;
        let cs = 0; for (let i = 0; i < 19; i++) cs ^= b[i]; b[19] = cs;
        (await window.__mock.getWeightCharacteristic()).__emit(b);
      };
      window.__mock = window.__test_installMultiBLEMock({ devices: ['scale', 'portal'] });
      await toggleConnect(); await toggleConnect();
      window.__test_setTdsDelay(0);
      await emit(0, 0);
      await triStateTimer(); // Start
      const rec = window.__test_recorder;
      const t0 = performance.now();
      let fake = 0;
      rec.now = () => t0 + fake;
      for (let i = 1; i <= 94; i++) {
        fake = i * 3000;
        await emit(i <= 76 ? i * 4 : i <= 84 ? 304 : 180, i * 3000);
        window.__mock.emitPortal({ ec: 1.2 + 5 * Math.exp(-Math.min(i, 84) / 18), temp: 91 - i * 0.1, battery: 100 });
      }
      if (stop) await triStateTimer(); // Stop
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.evaluate(() => { localStorage.setItem('scaleMemoryV1', JSON.stringify({ beans: { weight: 20 }, carafe: { weight: 186 } })); localStorage.setItem('tdsKvV1', '0.0052'); });
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__mock?.uninstall());
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const timer = (page) => page.locator('#timer');
const weight = (page) => page.locator('#weightDisplay');

test('optional: only a small Trim chip after Stop; nothing changes until it is used', async ({ page }) => {
  await page.evaluate(() => window.__lateStopBrew({ stop: false }));
  await expect(page.locator('#trimBtn')).toBeHidden(); // not while brewing
  await page.evaluate(() => triStateTimer());
  await expect(page.locator('#trimBtn')).toBeVisible();
  await expect(page.locator('#trimBtnLabel')).toHaveText('Trim');
  await expect(page.locator('#trimOverlay')).toBeHidden();
  await expect(page.locator('#trimBar')).toBeHidden();
  await expect(page.locator('#timerToggleBtn')).toBeVisible();
  await expect(timer(page)).toHaveText('4:42');
  await expect(weight(page)).toHaveText('180.0');
});

test('trim starts where the weight dropped, recomputes the values, and the trim is saved to the brew log and CSV', async ({ page }) => {
  await page.evaluate(() => window.__lateStopBrew());
  await expect(page.locator('#tdsValue')).not.toHaveText('1.40 %'); // the late Stop inflates TDS
  await page.click('#trimBtn');
  await expect(page.locator('#trimBar')).toBeVisible();
  await expect(page.locator('.ritual-main-actions')).toBeHidden();
  await expect(page.locator('#trimHint')).toHaveText('Weight dropped at 4:12 (dripper lifted). Drag to adjust.');
  await expect(page.locator('#trimTime')).toHaveText('4:12');
  // The values follow the line
  await expect(timer(page)).toHaveText('4:12');
  await expect(weight(page)).toHaveText('304.0');
  await expect(page.locator('#calculatedRatioDisplay')).toHaveText('1:15.2');
  await expect(page.locator('#flowRate')).toHaveText('1.2 g/s');
  await expect(page.locator('#tdsValue')).toHaveText('1.40 %');
  await expect(page.locator('#trimApplyBtn')).toHaveText('Trim to 4:12');

  await page.click('#trimApplyBtn');
  await expect(page.locator('#trimBar')).toBeHidden();
  await expect(page.locator('#timerToggleBtn')).toBeVisible();
  await expect(page.locator('#trimBtnLabel')).toHaveText('Trimmed');
  await expect(timer(page)).toHaveText('4:12');
  const csvLastT = await page.evaluate(() => {
    const lines = window.__test_recorder.toCSV().trim().split('\n');
    return parseFloat(lines[lines.length - 1].split(',')[0]);
  });
  expect(csvLastT).toBeLessThanOrEqual(252);
  await expect.poll(() => page.evaluate(async () => {
    const b = (await window.__test_brewLog.list())[0];
    return [b.summary.ms, b.summary.finalWeight, b.summary.elapsed, b.series.weight[b.series.weight.length - 1].t <= 252];
  })).toEqual([252000, 304, 252, true]);
});

test('-1 s / +1 s move the end; Cancel goes back; a trim can be changed or undone until Reset', async ({ page }) => {
  await page.evaluate(() => window.__lateStopBrew());
  await page.click('#trimBtn');
  for (let i = 0; i < 12; i++) await page.click('#trimBar button[aria-label="1 second earlier"]');
  await expect(page.locator('#trimTime')).toHaveText('4:00');
  await expect(timer(page)).toHaveText('4:00');
  await page.click('#trimBar .trim-text-btn'); // Cancel
  await expect(timer(page)).toHaveText('4:42'); // nothing was trimmed before
  await expect(page.locator('#trimBtnLabel')).toHaveText('Trim');

  // Trim to 4:12, then open again: Cancel keeps 4:12
  await page.click('#trimBtn');
  await page.click('#trimApplyBtn');
  await page.click('#trimBtn');
  await expect(page.locator('#trimTime')).toHaveText('4:12'); // starts at the current end
  await expect(page.locator('#trimHint')).toHaveText('Drag the line to where the brew ended.');
  await page.click('#trimBar button[aria-label="1 second earlier"]');
  await page.keyboard.press('Escape');
  await expect(timer(page)).toHaveText('4:12');
  await expect(page.locator('#trimBtnLabel')).toHaveText('Trimmed');

  // Undo: move the end back to Stop ("Keep all")
  await page.click('#trimBtn');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight'); // the line has focus
  await expect(page.locator('#trimApplyBtn')).toHaveText('Keep all');
  await page.click('#trimApplyBtn');
  await expect(timer(page)).toHaveText('4:42');
  await expect(page.locator('#trimBtnLabel')).toHaveText('Trim');
  await expect.poll(() => page.evaluate(async () => (await window.__test_brewLog.list())[0].summary.ms)).toBe(282000);
});

test('dragging the end line sets the end', async ({ page }) => {
  await page.evaluate(() => window.__lateStopBrew());
  await page.click('#trimBtn');
  const box = await page.locator('#trimOverlay').boundingBox();
  const line = await page.locator('#trimLine').boundingBox();
  await page.mouse.move(line.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const t = await page.locator('#trimTime').textContent();
  const [m, s] = t.split(':').map(Number);
  expect(m * 60 + s).toBeLessThan(200);
  expect(m * 60 + s).toBeGreaterThan(60);
  await expect(timer(page)).toHaveText(t);
});

test('Reset hides Trim; the next brew starts untrimmed', async ({ page }) => {
  await page.evaluate(() => window.__lateStopBrew());
  await page.click('#trimBtn');
  await page.click('#trimApplyBtn');
  await page.click('#timerToggleBtn'); // Reset
  await expect(page.locator('#trimBtn')).toBeHidden();
  await page.evaluate(() => triStateTimer()); // Start the next brew
  expect(await page.evaluate(() => [window.__test_recorder.trimmed, window.__test_recorder.rows.length === window.__test_recorder.allRows().length])).toEqual([false, true]);
});
