/**
 * Sync - keeps settings and the brew log the same on several devices, through a
 * brewlog-server (https://github.com/danprime/brewlog-server).
 *
 * The server stores records in collections ("settings", "brews") with an updatedAt time;
 * the newest write of each record wins, and deletes are kept as markers. A device:
 *   1. notes its own changes (a setting whose stored value changed, a brew saved since the last push),
 *   2. pulls everything that changed on the server since the last sequence number it saw,
 *      applying what is newer than its own copy,
 *   3. pushes its changes.
 * Each device keeps only its newest MAX_BREWS brews; the server keeps them all. Trimming old
 * brews locally is not a delete: only deleteBrew (markBrewDeleted) sends a delete marker.
 */

export const SYNCED_SETTINGS = ['scaleMemoryV1', 'brewRatioV1', 'bedAbsorptionV1', 'tdsKvV1', 'kvHistoryV1', 'timerDrivesV1'];
const CONFIG_KEY = 'syncConfigV1'; // { url, token }
const STATE_KEY = 'syncStateV1';
const PUSH_BATCH = 100; // brews per request (a few KB each)

const brewTime = (b) => b.updatedAt ?? b.at ?? b.id;

export class Sync {
  /**
   * @param {object} o
   * @param {import('./brew-log.js').BrewLog} o.brewLog
   * @param {(keys: string[]) => void} [o.onSettings] - settings were changed from another device
   * @param {() => void} [o.onBrews] - brews were added, changed or deleted from another device
   * @param {(status: {configured: boolean, syncing: boolean, lastSync: number|null, error: string|null}) => void} [o.onStatus]
   */
  constructor({ brewLog, storage = globalThis.localStorage, fetch = (...a) => globalThis.fetch(...a), now = () => Date.now(), onSettings, onBrews, onStatus } = {}) {
    Object.assign(this, { brewLog, storage, fetch, now, onSettings, onBrews, onStatus });
    this._running = null;
    this._again = false;
    this._timer = null;
    this.syncing = false;
  }

  _load(key, fallback) {
    try { return JSON.parse(this.storage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  _save(key, value) {
    try { this.storage.setItem(key, JSON.stringify(value)); } catch {}
  }

  get config() { return this._load(CONFIG_KEY, null); }
  get configured() { return !!(this.config?.url && this.config?.token); }
  get state() {
    return { seq: 0, lastPush: 0, lastSync: null, error: null, settings: {}, deleted: {}, ...this._load(STATE_KEY, {}) };
  }

  status() {
    const s = this.state;
    return { configured: this.configured, syncing: this.syncing, lastSync: s.lastSync, error: s.error };
  }
  _emit() { this.onStatus?.(this.status()); }

  /** Server address and token; a different server starts from scratch (everything is pulled, then pushed). */
  setConfig({ url, token }) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\/[^\s/]+/.test(clean) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(clean)) throw new Error('Enter the server address, starting with https://');
    if (!String(token || '').trim()) throw new Error('Enter the token.');
    const old = this.config;
    this._save(CONFIG_KEY, { url: clean, token: String(token).trim() });
    if (old?.url !== clean) this._save(STATE_KEY, { deleted: this.state.deleted });
    this._emit();
  }

  /** Stop syncing on this device. Its data stays, and turning it on again carries on where it stopped. */
  turnOff() {
    clearTimeout(this._timer);
    try { this.storage.removeItem(CONFIG_KEY); } catch {}
    this._emit();
  }

  /** The user deleted a brew: the delete goes to the other devices too. */
  markBrewDeleted(id) {
    const s = this.state;
    s.deleted[String(id)] = this.now();
    this._save(STATE_KEY, s);
    this.schedule();
  }

  /** Sync soon (changes made in quick succession go in one sync). */
  schedule(delayMs = 1500) {
    if (!this.configured) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync().catch(() => {}), delayMs);
  }

  /** One full sync; overlapping calls run once more after the current one. */
  async sync() {
    if (!this.configured) return;
    if (this._running) { this._again = true; return this._running; }
    this._running = (async () => {
      do {
        this._again = false;
        await this._syncOnce();
      } while (this._again);
    })().finally(() => { this._running = null; });
    return this._running;
  }

  async _request(method, path, body) {
    const { url, token } = this.config;
    let res;
    try {
      res = await this.fetch(`${url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new Error("Can't reach the server.");
    }
    if (res.status === 401) throw new Error('The server did not accept the token.');
    if (res.status === 429) throw new Error('Too many wrong tokens; try again in 10 minutes.');
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    return res.json();
  }

  async _syncOnce() {
    this.syncing = true;
    this._emit();
    const s = this.state;
    try {
      // 1. Note local setting changes (stored value differs from the last synced one). On the first
      //    sync with a server this waits until after the pull: what the server already has wins
      //    (this device may only have defaults), and only settings it lacks are sent.
      const first = !s.lastSync;
      const noteSettings = () => {
        for (const key of SYNCED_SETTINGS) {
          const value = this.storage.getItem(key);
          if (value !== null && value !== s.settings[key]?.value) s.settings[key] = { value, updatedAt: this.now(), dirty: true };
        }
      };
      if (!first) noteSettings();
      const pushFrom = s.lastPush;
      const pushStart = this.now();

      // 2. Pull
      const changedSettings = [];
      const applied = new Set(); // brews just written from the server: don't send them back
      let brewsChanged = false;
      let restarted = false;
      for (;;) {
        const since = s.seq;
        const page = await this._request('GET', `/api/sync?since=${since}`);
        if (page.seq < since && !restarted) { s.seq = 0; restarted = true; continue; } // the store was reset
        for (const r of page.records) {
          if (r.collection === 'settings' && SYNCED_SETTINGS.includes(r.id) && !r.deleted) {
            const known = s.settings[r.id];
            if (!known || r.updatedAt > known.updatedAt) {
              s.settings[r.id] = { value: r.data, updatedAt: r.updatedAt, dirty: false };
              try { this.storage.setItem(r.id, r.data); } catch {}
              changedSettings.push(r.id);
            }
          } else if (r.collection === 'brews') {
            if (await this._applyBrew(r, s)) { brewsChanged = true; applied.add(String(r.id)); }
          }
          // Other collections (beans, grind, ...) are for later versions
        }
        s.seq = page.seq;
        if (!page.more) break;
      }

      // 3. Push: dirty settings, brews saved since the last push, delete markers
      if (first) noteSettings();
      const pushedDeletes = { ...s.deleted };
      const records = [];
      for (const [id, v] of Object.entries(s.settings)) {
        if (v.dirty) records.push({ collection: 'settings', id, updatedAt: v.updatedAt, data: v.value });
      }
      for (const [id, at] of Object.entries(s.deleted)) records.push({ collection: 'brews', id, updatedAt: at, deleted: true });
      for (const b of await this.brewLog.list()) {
        if (brewTime(b) > pushFrom && !applied.has(String(b.id))) records.push({ collection: 'brews', id: String(b.id), updatedAt: brewTime(b), data: b });
      }
      for (let i = 0; i < records.length; i += PUSH_BATCH) {
        const res = await this._request('POST', '/api/sync', { records: records.slice(i, i + PUSH_BATCH) });
        s.seq = Math.max(s.seq, res.seq);
      }
      for (const v of Object.values(s.settings)) v.dirty = false;
      // Keep delete markers added while this sync ran (they go next time)
      s.deleted = {};
      for (const [id, at] of Object.entries(this.state.deleted)) if (pushedDeletes[id] !== at) s.deleted[id] = at;
      s.lastPush = pushStart;
      s.lastSync = this.now();
      s.error = null;
      this._save(STATE_KEY, s);
      if (changedSettings.length) this.onSettings?.(changedSettings);
      if (brewsChanged) this.onBrews?.();
    } catch (e) {
      s.error = e.message;
      this._save(STATE_KEY, s);
      throw e;
    } finally {
      this.syncing = false;
      this._emit();
    }
  }

  /** A brew from the server: newer than ours wins; our own unsent delete wins over an older copy. */
  async _applyBrew(r, s) {
    const id = Number(r.id);
    const local = await this.brewLog.get(id);
    const localTime = local ? brewTime(local) : 0;
    const deletedHere = s.deleted[String(r.id)];
    if (r.deleted) {
      if (local && r.updatedAt >= localTime) { await this.brewLog.remove(id); return true; }
      return false;
    }
    if (deletedHere && deletedHere >= r.updatedAt) return false;
    if (local && r.updatedAt <= localTime) return false;
    await this.brewLog.save({ ...r.data, id, updatedAt: r.updatedAt }, { keepUpdatedAt: true });
    return true;
  }
}
