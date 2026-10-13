/**
 * Test-only navigator.bluetooth mock that can simulate several devices at once
 * (BOOKOO scale and Belka Portal).
 *
 * requestDevice() behaves like a user picking the first not-yet-connected device
 * that matches the filters; it rejects with NotFoundError (like a cancelled
 * picker) when nothing matches. getDevices() returns the devices listed in
 * `permitted` plus any device previously returned by requestDevice().
 */

const BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/** Normalise a numeric (16-bit) or string UUID to its lowercase 128-bit form. */
export function canonicalUuid(uuid) {
  if (typeof uuid === 'number') return `0000${uuid.toString(16).padStart(4, '0')}${BASE_UUID_SUFFIX}`;
  return String(uuid).toLowerCase();
}

class MockEmitter {
  constructor() { this._listeners = {}; }
  addEventListener(ev, cb) { (this._listeners[ev] ||= new Set()).add(cb); }
  removeEventListener(ev, cb) { this._listeners[ev]?.delete(cb); }
  _fire(ev, event) { for (const cb of [...(this._listeners[ev] || [])]) cb(event); }
}

class MockCharacteristic extends MockEmitter {
  constructor(uuid, properties) {
    super();
    this.uuid = canonicalUuid(uuid);
    this.properties = { read: false, write: false, writeWithoutResponse: false, notify: false, indicate: false, ...properties };
    this.writes = [];
  }
  async startNotifications() { return this; }
  async stopNotifications() { return this; }
  async writeValue(buf) { this._record(buf); }
  async writeValueWithResponse(buf) { this._record(buf); }
  async writeValueWithoutResponse(buf) { this._record(buf); }
  _record(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    this.writes.push(Array.from(bytes));
  }
  /** Emit a notification. Accepts an ArrayBuffer, typed array, or plain byte array. */
  __emit(data) {
    const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
    const value = new DataView(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    this._fire('characteristicvaluechanged', { target: { value } });
  }
}

class MockService {
  constructor(uuid, chars) {
    this.uuid = canonicalUuid(uuid);
    this._chars = new Map(chars.map((c) => [c.uuid, c]));
  }
  async getCharacteristic(uuid) {
    const c = this._chars.get(canonicalUuid(uuid));
    if (!c) throw new DOMException(`No characteristic ${uuid}`, 'NotFoundError');
    return c;
  }
  async getCharacteristics() { return [...this._chars.values()]; }
}

class MockDevice extends MockEmitter {
  constructor(id, name, service) {
    super();
    this.id = id;
    this.name = name;
    this.service = service;
    const device = this;
    this.gatt = {
      device,
      connected: false,
      hang: false, // set true to simulate an out-of-range device whose connect never resolves
      async connect() {
        if (this.hang) return new Promise(() => {});
        this.connected = true;
        return this;
      },
      disconnect() {
        if (!this.connected) return;
        this.connected = false;
        device._fire('gattserverdisconnected', { target: device });
      },
      async getPrimaryService(uuid) {
        if (canonicalUuid(uuid) !== device.service.uuid) throw new DOMException(`No service ${uuid}`, 'NotFoundError');
        return device.service;
      },
    };
  }
  matches(filter) {
    if (filter.services && filter.services.some((s) => canonicalUuid(s) === this.service.uuid)) return true;
    if (filter.name && filter.name === this.name) return true;
    if (filter.namePrefix && this.name.startsWith(filter.namePrefix)) return true;
    return false;
  }
}

function makeScale() {
  return new MockDevice('mock-scale-id', 'MockScale', new MockService(0x0ffe, [
    new MockCharacteristic(0xff11, { notify: true }),
    new MockCharacteristic(0xff12, { write: true, writeWithoutResponse: true }),
  ]));
}

function makePortal() {
  return new MockDevice('mock-portal-id', 'BelkaPortal', new MockService(0x7400, [
    new MockCharacteristic(0x7410, { notify: true }),
    new MockCharacteristic(0x7411, { notify: true }),
    new MockCharacteristic(0x7420, { write: true, writeWithoutResponse: true, notify: true }),
  ]));
}

/**
 * Install the mock as navigator.bluetooth.
 * @param {{devices?: Array<'scale'|'portal'>, permitted?: Array<'scale'|'portal'>, getDevices?: boolean}} opts
 */
export function installMockBluetooth({ devices = ['scale'], permitted = [], getDevices = true } = {}) {
  const original = typeof navigator !== 'undefined' ? navigator.bluetooth : undefined;
  const all = { scale: makeScale(), portal: makePortal() };
  const available = devices.map((t) => all[t]);
  const granted = new Set(permitted.map((t) => all[t]));
  const requests = [];

  const mock = {
    requests,
    async requestDevice(options) {
      requests.push(options);
      const filters = options?.filters || [];
      const dev = available.find((d) => !d.gatt.connected && filters.some((f) => d.matches(f)));
      if (!dev) throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
      granted.add(dev);
      return dev;
    },
  };
  if (getDevices) mock.getDevices = async () => [...granted];

  if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'bluetooth', { value: mock, configurable: true });
  }

  const char = (type, uuid) => all[type].service._chars.get(canonicalUuid(uuid));

  return {
    mock,
    device: (type) => all[type],
    uninstall() {
      if (typeof navigator !== 'undefined') Object.defineProperty(navigator, 'bluetooth', { value: original, configurable: true });
    },
    // Scale helpers (kept compatible with the original installMock API)
    async getWeightCharacteristic() { return char('scale', 0xff11); },
    scaleCommandWrites: () => char('scale', 0xff12).writes,
    // Portal helpers
    portalStream: () => char('portal', 0x7410),
    portalCommandWrites: () => char('portal', 0x7420).writes,
    /** Emit a Portal stream packet with the given readings. */
    emitPortal({ ec = 0, internalTemp = 30, temp = 0, battery = 100 } = {}) {
      const dv = new DataView(new ArrayBuffer(13));
      dv.setFloat32(0, ec, true);
      dv.setFloat32(4, internalTemp, true);
      dv.setFloat32(8, temp, true);
      dv.setUint8(12, battery);
      char('portal', 0x7410).__emit(dv.buffer);
    },
  };
}

export default installMockBluetooth;
