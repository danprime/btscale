/**
 * BrewLog - saved brews (summary + downsampled chart points) in IndexedDB.
 *
 * A brew: { id, at, updatedAt, name, summary: {...}, series: { weight: [{t, v}], ec: [{t, v}] } }
 * `id` is the brew's start time (ms since epoch), so it is unique and sorts by date.
 * Only the newest MAX_BREWS are kept. Falls back to memory if IndexedDB is unavailable.
 * `updatedAt` is set on every save (sync sends brews changed since its last push); `onChange`
 * is called after a local save.
 */
export const MAX_BREWS = 100;
export const MAX_POINTS = 300; // per chart line

const DB_NAME = 'btscaleBrewLogV1';
const STORE = 'brews';

/** Keep at most `max` points, evenly spaced, always including the last one. */
export function downsample(points, max = MAX_POINTS) {
  if (points.length <= max) return points.slice();
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class BrewLog {
  constructor() {
    this._db = null;
    this._memory = null; // Map, when IndexedDB can't be used
    this._persistAsked = false;
    this.onChange = null;
  }

  async _open() {
    if (this._db || this._memory) return;
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      this._db = await request(req);
    } catch {
      this._memory = new Map();
    }
  }

  async _store(mode) {
    await this._open();
    return this._db ? this._db.transaction(STORE, mode).objectStore(STORE) : null;
  }

  /** Newest first. */
  async list() {
    const store = await this._store('readonly');
    const all = store ? await request(store.getAll()) : [...this._memory.values()];
    return all.sort((a, b) => b.id - a.id);
  }

  async count() {
    const store = await this._store('readonly');
    return store ? request(store.count()) : this._memory.size;
  }

  async get(id) {
    const store = await this._store('readonly');
    return store ? request(store.get(id)) : this._memory.get(id);
  }

  /**
   * Add or replace a brew, then drop the oldest beyond MAX_BREWS (dropping is not a delete:
   * the sync server keeps them). `keepUpdatedAt` is for brews that come from the sync server.
   */
  async save(brew, { keepUpdatedAt = false } = {}) {
    this._askPersist();
    const entry = keepUpdatedAt ? brew : { ...brew, updatedAt: Date.now() };
    const store = await this._store('readwrite');
    if (store) await request(store.put(entry));
    else this._memory.set(entry.id, entry);
    const all = await this.list();
    for (const old of all.slice(MAX_BREWS)) await this.remove(old.id);
    if (!keepUpdatedAt) this.onChange?.();
  }

  async update(id, changes) {
    const brew = await this.get(id);
    if (!brew) return null;
    const next = { ...brew, ...changes, summary: { ...brew.summary, ...(changes.summary || {}) } };
    await this.save(next);
    return next;
  }

  async remove(id) {
    const store = await this._store('readwrite');
    if (store) await request(store.delete(id));
    else this._memory.delete(id);
  }

  /** Ask the browser not to clear the log under storage pressure (best effort). */
  _askPersist() {
    if (this._persistAsked) return;
    this._persistAsked = true;
    try { navigator.storage?.persist?.(); } catch {}
  }
}

export default BrewLog;
