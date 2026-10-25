const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Sync between devices: two browser contexts (each with its own storage) and a local sync
// server with the same protocol as brewlog-server (records, newest write wins, delete markers, seq).

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

const TOKEN = 't'.repeat(64);

function createSyncServer() {
  const records = new Map(); // "collection/id" -> record
  let seq = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const out = [...records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return send(200, { seq: out.length ? out[out.length - 1].seq : seq, more: false, records: out.map(({ seq: _, ...r }) => r) });
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let accepted = 0;
      for (const r of JSON.parse(body).records) {
        const key = `${r.collection}/${r.id}`;
        const current = records.get(key);
        if (current && current.updatedAt >= r.updatedAt) continue;
        records.set(key, { collection: r.collection, id: String(r.id), updatedAt: r.updatedAt, deleted: !!r.deleted, ...(r.deleted ? {} : { data: r.data }), seq: ++seq });
        accepted++;
      }
      send(200, { seq, accepted, ignored: 0 });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, records })));
}

let app, sync, syncUrl, appUrl;

test.beforeEach(async () => {
  app = await createStaticServer(path.resolve(__dirname, '..'));
  sync = await createSyncServer();
  appUrl = `http://127.0.0.1:${app.address().port}/index.html`;
  syncUrl = `http://127.0.0.1:${sync.server.address().port}`;
});

test.afterEach(async () => {
  for (const s of [app, sync.server]) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

/** A device: its own browser context (storage, IndexedDB), with optional saved settings. */
async function device(browser, storage = {}) {
  const context = await browser.newContext({ viewport: { width: 384, height: 720 } });
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.evaluate((items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }, storage);
  await page.reload();
  return page;
}

/** Settings > Sync: enter the server and token, Turn on. */
async function turnOnSync(page, token = TOKEN) {
  await page.click('#settingsBtn');
  await page.click('#syncBtn');
  await page.fill('#syncUrl', syncUrl);
  await page.fill('#syncToken', token);
  await page.click('#syncSaveBtn');
}

const syncNow = (page) => page.evaluate(() => window.__test_sync.sync());
const brew = (id, name) => ({ id, at: id, name, summary: { hasScale: true, hasEc: false, ms: 180000, elapsed: 180, finalWeight: 300, dose: 20, ciy: null }, series: { weight: [{ t: 0, v: 0 }, { t: 180, v: 300 }], ec: [] } });

test('settings and brews made on one device show up on the other', async ({ browser }) => {
  const phone = await device(browser, { scaleMemoryV1: JSON.stringify({ beans: { weight: 20 }, carafe: { weight: 186 } }) });
  await turnOnSync(phone);
  await expect(phone.locator('#syncRowMeta')).toHaveText(/\d/); // the time of the last sync
  await expect(phone.locator('#syncError')).toBeHidden();
  // Change the ratio in Settings and save a brew
  await phone.click('#closeSync, #syncModal .btn-secondary >> text=Close');
  await phone.click('#ratioEditBtn');
  await phone.fill('#ratioInput', '16');
  await phone.press('#ratioInput', 'Enter');
  await phone.evaluate((b) => window.__test_brewLog.save(b), brew(Date.now() - 60000, 'Morning V60'));
  await syncNow(phone);
  expect(sync.records.get('settings/brewRatioV1').data).toBe('16');
  expect(sync.records.get('brews/' + [...sync.records.keys()].find((k) => k.startsWith('brews/')).split('/')[1]).data.name).toBe('Morning V60');

  const ipad = await device(browser);
  await turnOnSync(ipad);
  await expect(ipad.locator('#ratioSettingValue')).toHaveText('16');
  await expect(ipad.locator('#memoryBeansWeight')).toHaveText('20 g');
  await expect(ipad.locator('#targetWeight')).toHaveText('20 → 320 g'); // dose x ratio, from the other device
  await expect(ipad.locator('#brewLogCount')).toHaveText('1 brew');
});

test("a new device's own defaults do not overwrite the settings already on the server", async ({ browser }) => {
  const phone = await device(browser, { brewRatioV1: '16' });
  await turnOnSync(phone);
  await expect(phone.locator('#syncRowMeta')).toHaveText(/\d/);
  const ipad = await device(browser, { brewRatioV1: '15' }); // set before sync was turned on
  await turnOnSync(ipad);
  await expect(ipad.locator('#ratioSettingValue')).toHaveText('16');
  expect(sync.records.get('settings/brewRatioV1').data).toBe('16');
});

test('a rename and a delete reach the other device', async ({ browser }) => {
  const id = Date.now() - 3600000;
  const phone = await device(browser);
  await phone.evaluate((b) => window.__test_brewLog.save(b), brew(id, 'Morning V60'));
  await turnOnSync(phone);
  await expect(phone.locator('#syncRowMeta')).toHaveText(/\d/);
  const ipad = await device(browser);
  await turnOnSync(ipad);
  await expect(ipad.locator('#brewLogCount')).toHaveText('1 brew');

  // Rename on the iPad
  await ipad.evaluate((id) => window.__test_brewLog.update(id, { name: 'Renamed on iPad' }), id);
  await syncNow(ipad);
  await syncNow(phone);
  expect((await phone.evaluate((id) => window.__test_brewLog.get(id), id)).name).toBe('Renamed on iPad');

  // Delete on the phone (Settings > Brew log > brew > Delete)
  await phone.click('#syncModal .btn-secondary >> text=Close');
  await phone.click('#brewLogBtn');
  await phone.click('.log-item');
  await phone.click('#logDeleteBtn');
  await phone.click('#logDeleteConfirmBtn');
  // The delete finishes asynchronously; a sync that was already running sends it next time
  await expect.poll(async () => { await syncNow(phone); return sync.records.get(`brews/${id}`).deleted; }).toBe(true);
  await syncNow(ipad);
  expect(await ipad.evaluate((id) => window.__test_brewLog.get(id), id)).toBeUndefined();
});

test('a wrong token is refused and shown; Turn off stops syncing and keeps the data', async ({ browser }) => {
  const phone = await device(browser, { brewRatioV1: '17' });
  await turnOnSync(phone, 'wrong-token');
  await expect(phone.locator('#syncError')).toHaveText('The server did not accept the token.');
  await expect(phone.locator('#syncRowMeta')).toHaveText('Not synced');
  expect(sync.records.size).toBe(0);
  await phone.click('#syncOffBtn');
  await expect(phone.locator('#syncRowMeta')).toHaveText('Off');
  await expect(phone.locator('#syncOffBtn')).toBeHidden();
  await expect(phone.locator('#ratioSettingValue')).toHaveText('17');
  // Only https (or localhost while testing)
  await phone.fill('#syncUrl', 'http://brewlog.example.com');
  await phone.fill('#syncToken', TOKEN);
  await phone.click('#syncSaveBtn');
  await expect(phone.locator('#syncError')).toHaveText('Enter the server address, starting with https://');
});
