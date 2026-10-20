const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');

// Simple static server for the test directory
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
      // simple content-type handling
      const ext = path.extname(filePath).toLowerCase();
      const map = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', map[ext] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

test('settings modal labels are visible and not clipped', async ({ page }) => {
  const root = path.resolve(__dirname, '..');
  const { server, port } = await createStaticServer(root, 0);
  const baseUrl = `http://localhost:${port}`;
  await page.goto(`${baseUrl}/index.html`);
  // Open settings modal by clicking the settings button.
  await page.click('#settingsBtn');
  // Give the UI a moment to animate the modal open
  await page.waitForTimeout(300);
  const modal = page.locator('#settingsModal');
  await expect(modal).toBeVisible({ timeout: 4000 });

  // capture screenshot for manual review
  await page.screenshot({ path: 'playwright-settings.png', fullPage: false });

  // Find buttons inside modal and ensure their labels are not clipped.
  // We check that computed style allows wrapping and that the element has height > 0
  // Only check buttons that are visible (exclude hidden nested modals)
  const allButtons = await modal.locator('.ritual-btn').elementHandles();
  const visibleButtons = [];
  for (const handle of allButtons) {
    const visible = await handle.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    });
    if (visible) visibleButtons.push(handle);
  }
  expect(visibleButtons.length).toBeGreaterThan(0);

  for (const handle of visibleButtons) {
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThan(8);
    const overflow = await handle.evaluate((el) => {
      const inner = el.querySelector('*');
      if (!inner) return false;
      return inner.scrollWidth > inner.clientWidth + 1 || inner.scrollHeight > inner.clientHeight + 1;
    });
    expect(overflow).toBeFalsy();
  }
  // shutdown server
  // Drop keep-alive sockets first, or close() can hang (seen with Chromium on Windows)
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

for (const size of [{ width: 384, height: 720 }, { width: 375, height: 667 }, { width: 375, height: 560 }]) {
  test(`settings scrolls to its last option (Connect) on a ${size.width}x${size.height} phone`, async ({ page }) => {
    const { server, port } = await createStaticServer(path.resolve(__dirname, '..'), 0);
    await page.setViewportSize(size);
    await page.goto(`http://localhost:${port}/index.html`);
    await page.click('#settingsBtn');
    const modal = page.locator('#settingsModal');
    await modal.evaluate((m) => { m.scrollTop = m.scrollHeight; });
    const last = await page.locator('#connectToggleBtn').boundingBox(); // last visible option
    expect(last.y).toBeGreaterThanOrEqual(0);
    expect(last.y + last.height).toBeLessThanOrEqual(size.height);
    // The top (close button, Memory) is still reachable
    await modal.evaluate((m) => { m.scrollTop = 0; });
    const close = await page.locator('#closeSettingsModal').boundingBox();
    expect(close.y).toBeGreaterThanOrEqual(0);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
}

test('Brew log sits above Connect, clear of the close button; device settings are hidden', async ({ page }) => {
  const { server, port } = await createStaticServer(path.resolve(__dirname, '..'), 0);
  await page.setViewportSize({ width: 384, height: 720 });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.click('#settingsBtn');
  const box = async (sel) => page.locator(sel).boundingBox();
  const log = await box('#brewLogBtn');
  const close = await box('#closeSettingsModal');
  const connect = await box('#connectToggleBtn');
  const title = await box('#settingsTitle');
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(log, close)).toBe(false);
  expect(log.y).toBeGreaterThan(title.y); // under the Settings heading
  expect(log.y + log.height).toBeLessThanOrEqual(connect.y); // above Connect
  // Hidden for now, but still in the page
  await expect(page.locator('#moreSettings')).toBeHidden();
  await expect(page.locator('#driveScaleTimer')).toBeAttached();
  await expect(page.locator('#logToggle')).toBeAttached();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
