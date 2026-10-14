/**
 * DeviceManager - owns the scale and the EC meter (Belka Portal) connections and
 * implements the single "Connect" button behaviour:
 *
 * - Devices that were connected before and that the browser still has permission
 *   for (navigator.bluetooth.getDevices(), where supported) are reconnected
 *   without a picker.
 * - Any other missing device type is offered in ONE picker. Browsers only allow
 *   one picker per user gesture, so with two new devices the button is pressed
 *   once per device.
 *
 * Emits 'change' whenever a device connects or disconnects.
 */
import { SimpleEmitter } from './emitter.js';
import ScaleController from './bookoo-scale.js';
import { SERVICE_UUID as SCALE_SERVICE_UUID } from './ble-scale.js';
import { BelkaPortal, PORTAL_NAME, PORTAL_FILTER, PORTAL_SERVICE_UUID } from './belka-portal.js';

export const DEVICE_TYPES = ['scale', 'portal'];
const STORAGE_KEY = 'bleDeviceIdsV1';
const RECONNECT_TIMEOUT_MS = 8000;

const FILTERS = {
  scale: [{ services: [SCALE_SERVICE_UUID] }],
  portal: [PORTAL_FILTER],
};
const OPTIONAL_SERVICES = {
  scale: [],
  portal: [PORTAL_SERVICE_UUID],
};

/** Guess which kind of device the user picked. */
export function deviceTypeOf(device) {
  return device && device.name === PORTAL_NAME ? 'portal' : 'scale';
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Connection timed out')), ms); }),
  ]);
}

export class DeviceManager extends SimpleEmitter {
  /** @param {{bluetooth?: any, storage?: Storage, reconnectTimeoutMs?: number}} options */
  constructor(options = {}) {
    super();
    this.bluetooth = options.bluetooth || null;
    this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.scale = new ScaleController({ bluetooth: options.bluetooth });
    this.portal = new BelkaPortal({ bluetooth: options.bluetooth });
    this.names = { scale: null, portal: null };
    this.reconnectTimeoutMs = options.reconnectTimeoutMs ?? RECONNECT_TIMEOUT_MS;
    for (const type of DEVICE_TYPES) {
      this.controller(type).addEventListener('disconnected', () => this.emit('change', { type, connected: false }));
    }
  }

  controller(type) { return type === 'scale' ? this.scale : this.portal; }

  isConnected(type) { return this.controller(type).isConnected(); }

  connectedTypes() { return DEVICE_TYPES.filter((t) => this.isConnected(t)); }

  missingTypes() { return DEVICE_TYPES.filter((t) => !this.isConnected(t)); }

  allConnected() { return this.missingTypes().length === 0; }

  anyConnected() { return this.connectedTypes().length > 0; }

  _bt() { return this.bluetooth || (typeof navigator !== 'undefined' ? navigator.bluetooth : null); }

  _loadIds() {
    try { return JSON.parse(this.storage?.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  }

  _saveId(type, id) {
    if (!this.storage) return;
    const ids = this._loadIds();
    if (id) ids[type] = id; else delete ids[type];
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch {}
  }

  async _connectType(type, device) {
    const info = await this.controller(type).connect({ device });
    this.names[type] = info?.name || device?.name || null;
    if (device?.id) this._saveId(type, device.id);
    this.emit('change', { type, connected: true });
    return info;
  }

  /**
   * Connect whichever device types are not connected yet. Must be called from a
   * user gesture (button click) because it may open the browser's device picker.
   * @returns {Promise<{connected: string[], failed: Array<{type:string, error:Error}>}>}
   */
  async connectMissing() {
    const bt = this._bt();
    if (!bt || !bt.requestDevice) throw new Error('Bluetooth not available');
    const missing = this.missingTypes();
    if (!missing.length) return { connected: [], failed: [] };

    // Remembered devices can be reconnected without a picker.
    let known = [];
    if (typeof bt.getDevices === 'function') {
      try { known = await bt.getDevices(); } catch { known = []; }
    }
    const ids = this._loadIds();
    const attempts = [];
    const needPicker = [];
    for (const type of missing) {
      const dev = known.find((d) => d.id && d.id === ids[type]);
      if (dev) attempts.push({ type, promise: this._reconnect(type, dev) });
      else needPicker.push(type);
    }

    // Open the picker straight away (it needs the still-active user gesture).
    if (needPicker.length) {
      let picked = null;
      try {
        picked = await bt.requestDevice({
          filters: needPicker.flatMap((t) => FILTERS[t]),
          optionalServices: needPicker.flatMap((t) => OPTIONAL_SERVICES[t]),
        });
      } catch (err) {
        // NotFoundError = the user closed the picker; anything else is a real failure.
        if (err?.name !== 'NotFoundError') attempts.push({ type: needPicker.join('/'), promise: Promise.reject(err) });
      }
      if (picked) {
        const type = needPicker.length === 1 ? needPicker[0] : deviceTypeOf(picked);
        attempts.push({ type, promise: this._connectType(type, picked) });
      }
    }

    const results = await Promise.allSettled(attempts.map((a) => a.promise));
    const out = { connected: [], failed: [] };
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.connected.push(attempts[i].type);
      else out.failed.push({ type: attempts[i].type, error: r.reason });
    });
    return out;
  }

  async _reconnect(type, device) {
    try {
      return await withTimeout(this._connectType(type, device), this.reconnectTimeoutMs);
    } catch (err) {
      // Out of range or no longer available: forget it so the next press shows the picker.
      try { device.gatt?.disconnect?.(); } catch {}
      this._saveId(type, null);
      throw err;
    }
  }

  async disconnectAll() {
    await Promise.allSettled(this.connectedTypes().map((t) => this.controller(t).disconnect()));
  }
}

export default DeviceManager;
