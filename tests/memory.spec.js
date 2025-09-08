const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');

// Reuse the small static server helper used in other tests
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
    server.listen(port, () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

test('memory overwrite flow updates localStorage and UI', async ({ page }) => {
  const root = path.resolve(__dirname, '..');
  const { server, port } = await createStaticServer(root, 0);
  const baseUrl = `http://localhost:${port}`;
  await page.goto(`${baseUrl}/index.html`);

  // seed a weight into the display so overwrite uses it
  await page.evaluate(() => {
    document.getElementById('weightDisplay').textContent = '42.50';
  });

  // Open settings modal
  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsModal', { state: 'visible' });

  // Click Overwrite for Beans
  await page.click('button.memory-overwrite');
  // Confirm modal should appear
  await page.waitForSelector('#memoryConfirmModal', { state: 'visible' });

  // Click Cancel first
  await page.click('#memoryConfirmModal .modal-content .ritual-btn');
  // Ensure confirm modal hidden
  await page.waitForSelector('#memoryConfirmModal', { state: 'hidden' });

  // Click Overwrite again and confirm
  await page.click('button.memory-overwrite');
  await page.waitForSelector('#memoryConfirmModal', { state: 'visible' });
  // Click Overwrite confirm button (it has id memoryConfirmBtn)
  await page.click('#memoryConfirmBtn');

  // Verify UI updated
  const displayed = await page.textContent('#memoryBeansWeight');
  expect(displayed.trim()).toBe('42.50');

  // Verify localStorage updated
  const stored = await page.evaluate(() => localStorage.getItem('scaleMemoryV1'));
  const obj = JSON.parse(stored);
  expect(obj.beans.weight.toFixed(2)).toBe('42.50');

  await new Promise((r) => server.close(r));
});
