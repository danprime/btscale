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

// Simulate weight update by calling the exposed test helper __test_updateDisplay
test('weight and calculated ratio update correctly', async ({ page }) => {
  const root = path.resolve(__dirname, '..');
  const { server, port } = await createStaticServer(root, 0);
  const baseUrl = `http://localhost:${port}`;
  await page.goto(`${baseUrl}/index.html`);

  // Seed bean memory to 25g for ratio calculation
  await page.evaluate(() => {
    window.__test_setMemory({ beans: { weight: 25 } });
  });

  // Create a sample scaleData object and call the update helper
  const sample = { weight: 100.5, flowRate: 1.23, milliseconds: 65000, batteryPercent: 90 };
  await page.evaluate((s) => {
    window.__test_updateDisplay(s);
  }, sample);

  // Assert weight display updated
  const weightText = await page.textContent('#weightDisplay');
  expect(weightText.trim()).toBe('100.5');

  // Assert calculated ratio shows 1:4.0 (100.5 / 25 = 4.02 -> 4.0)
  const ratioText = await page.textContent('#calculatedRatioDisplay');
  expect(ratioText.trim()).toBe('1:4.0');

  // flowRate updated
  const flow = await page.textContent('#flowRate');
  expect(flow.trim()).toBe('1.23 g/s');

  await new Promise((r) => server.close(r));
});
