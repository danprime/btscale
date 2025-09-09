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
    server.listen(port, () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

test('connect and disconnect flow updates UI controls', async ({ page }) => {
  const root = path.resolve(__dirname, '..');
  const { server, port } = await createStaticServer(root, 0);
  const baseUrl = `http://localhost:${port}`;
  await page.goto(`${baseUrl}/index.html`);

  // Initially disconnected: Connect button should read 'Connect' and tare disabled
  const connectBtn = page.locator('#connectToggleBtn');
  await expect(connectBtn).toHaveText('Connect');
  await expect(page.locator('#tareBtn')).toBeDisabled();

  // Simulate connect
  await page.evaluate(() => window.__test_setConnected(true));
  await expect(connectBtn).toHaveText('Disconnect');
  await expect(page.locator('#tareBtn')).toBeEnabled();

  // Simulate disconnect
  await page.evaluate(() => window.__test_disconnect());
  await expect(connectBtn).toHaveText('Connect');
  await expect(page.locator('#tareBtn')).toBeDisabled();

  await new Promise((r) => server.close(r));
});
