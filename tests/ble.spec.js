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

// Helper to craft a fake characteristic buffer. Use the same parseWeightData format expected by scale-utils.
function craftBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}

test('connectToScale works with BLE mock and delivers weight updates', async ({ page }) => {
  const root = path.resolve(__dirname, '..');
  const { server, port } = await createStaticServer(root, 0);
  const baseUrl = `http://localhost:${port}`;
  await page.goto(`${baseUrl}/index.html`);

  // install BLE mock and get handle to weight characteristic
  await page.evaluate(() => {
    window.__bleMock = window.__test_installBLEMock();
  });

  // call the real connectToScale which should use the mocked navigator.bluetooth
  await page.evaluate(() => connectToScale());

  // ensure UI reflects connected status
  await page.waitForSelector('#status.connected', { timeout: 2000 });

  // get a handle to the mocked weight characteristic on the page and emit a fake notification
  // Emit a fake notification from the mocked characteristic inside the page
  await page.evaluate(() => {
    return window.__bleMock.getWeightCharacteristic().then((c) => {
      const bytes = new Uint8Array(20);
      bytes[0] = 0x03; // product
      bytes[1] = 0x0B; // type expected by parser
      // milliseconds (3 bytes)
      bytes[2] = 0x00; bytes[3] = 0x01; bytes[4] = 0xF4;
      bytes[5] = 0x00; // weight unit
      bytes[6] = 0x00; // weightSymbol (0 = positive)
      // rawWeight 100.50 g -> 10050 -> 0x00 0x27 0x3A
      bytes[7] = 0x00; bytes[8] = 0x27; bytes[9] = 0x3A;
      // flowSymbol and rawFlowRate 1.23 -> 123 -> 0x00 0x7B
      bytes[10] = 0x00; bytes[11] = 0x00; bytes[12] = 0x7B;
      bytes[13] = 90; // batteryPercent
      bytes[14] = 0x00; bytes[15] = 0x00; // standbyTime
      bytes[16] = 0x00; // buzzer
      bytes[17] = 0x00; // flow smoothing
      bytes[18] = 0x00; // reserved
      // checksum: XOR of bytes[0..18]
      let cs = 0;
      for (let i = 0; i < 19; i++) cs ^= bytes[i];
      bytes[19] = cs;
      c.__emit(bytes.buffer);
    });
  });

  // Wait for UI to update - poll until weightDisplay text is not '--'
  await page.waitForFunction(() => {
    const el = document.getElementById('weightDisplay');
    return el && el.textContent && el.textContent.trim() !== '--';
  }, { timeout: 4000 });

  // Cleanup
  await page.evaluate(() => { window.__bleMock.uninstall(); delete window.__bleMock; });
  await new Promise((r) => server.close(r));
});
