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

test('Bean Dose and Carafe/Server are typed in Settings, never taken from the scale', async ({ page }) => {
  const root = path.resolve(__dirname, '..');
  const { server, port } = await createStaticServer(root, 0);
  const baseUrl = `http://localhost:${port}`;
  await page.goto(`${baseUrl}/index.html`);

  // A weight on the scale display must not be used by Overwrite
  await page.evaluate(() => {
    document.getElementById('weightDisplay').textContent = '42.50';
  });

  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsModal', { state: 'visible' });
  await expect(page.locator('#memoryConfirmModal')).toHaveCount(0); // no scale-weight confirm popup

  // Bean Dose: Overwrite -> input (empty, not 42.50) -> validation -> Enter saves
  await page.click('#memoryBeansEditBtn');
  await expect(page.locator('#memoryBeansEditBtn')).toHaveText('Save');
  const beans = page.locator('#beansMemoryInput');
  await expect(beans).toBeVisible();
  await expect(beans).toHaveValue('');
  for (const bad of ['0', '-5', '6000', '']) {
    await beans.fill(bad);
    await page.click('#memoryBeansEditBtn');
    await expect(page.locator('#memoryError')).toBeVisible();
    await expect(beans).toBeVisible(); // still editing
  }
  await beans.fill('18.5');
  await expect(page.locator('#memoryError')).toBeHidden(); // typing clears the error
  await beans.press('Enter');
  await expect(page.locator('#memoryBeansWeight')).toHaveText('18.50');
  await expect(page.locator('#memoryBeansEditBtn')).toHaveText('Overwrite');
  await expect(page.locator('#targetWeight')).toHaveText('18.5gin → 277.5gout'); // target follows the dose

  // Carafe/Server: Save button; editing again starts from the stored value
  await page.click('#memoryCarafeEditBtn');
  await page.locator('#carafeMemoryInput').fill('186');
  await page.click('#memoryCarafeEditBtn');
  await expect(page.locator('#memoryCarafeWeight')).toHaveText('186.00');
  await page.click('#memoryCarafeEditBtn');
  await expect(page.locator('#carafeMemoryInput')).toHaveValue('186');

  // Escape cancels without saving and keeps Settings open
  await page.locator('#carafeMemoryInput').fill('500');
  await page.locator('#carafeMemoryInput').press('Escape');
  await expect(page.locator('#memoryCarafeWeight')).toHaveText('186.00');
  await expect(page.locator('#settingsModal')).toBeVisible();

  // Stored and restored across reloads
  const obj = JSON.parse(await page.evaluate(() => localStorage.getItem('scaleMemoryV1')));
  expect(obj).toEqual({ beans: { weight: 18.5 }, carafe: { weight: 186 } });
  await page.reload();
  await expect(page.locator('#memoryBeansWeight')).toHaveText('18.50');
  await expect(page.locator('#memoryCarafeWeight')).toHaveText('186.00');

  // Drop keep-alive sockets first, or close() can hang (seen with Chromium on Windows)
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
