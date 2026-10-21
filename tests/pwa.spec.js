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
      const map = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      res.setHeader('Content-Type', map[ext] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port: server.address().port }));
  });
}

let server;
let baseUrl;

test.beforeEach(async ({ page }) => {
  const started = await createStaticServer(path.resolve(__dirname, '..'), 0);
  server = started.server;
  baseUrl = `http://localhost:${started.port}`;
  await page.goto(`${baseUrl}/index.html`);
});

test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

test('installable as "Brew Tool": manifest, icons and theme colour', async ({ page }) => {
  await expect(page).toHaveTitle('Brew Tool');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#fff8e1');

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    return (await fetch(href)).json();
  });
  expect(manifest.name).toBe('Brew Tool');
  expect(manifest.short_name).toBe('Brew Tool');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  const sizes = manifest.icons.map((i) => `${i.sizes} ${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));

  // Every icon loads and has the size the manifest says
  for (const icon of manifest.icons) {
    const size = await page.evaluate((src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
      img.onerror = () => resolve('failed');
      img.src = src;
    }), icon.src);
    expect(size).toBe(icon.sizes);
  }

  // Chrome's own check before it offers "Install app"
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});
