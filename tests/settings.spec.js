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
  await new Promise((r) => server.close(r));
});
