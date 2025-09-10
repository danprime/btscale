/**
 * BleScale - small wrapper around navigator.bluetooth for the BOOKOO scale.
 *
 * Provides a predictable API for connecting, receiving notifications, writing
 * commands, and installing a test-only mock for Playwright tests.
 *
 * This file is ESM and exports the BleScale class and an `installMock` helper.
 */

// Service and characteristic UUIDs (numeric form to match existing code)
const SERVICE_UUID = 0x0FFE;
const COMMAND_CHAR_UUID = 0xFF12;
const WEIGHT_CHAR_UUID = 0xFF11;

/**
 * Lightweight EventTarget-like API (not full spec) used for tests and UI wiring.
 */
class SimpleEmitter {
  constructor() { this._listeners = Object.create(null); }
  addEventListener(name, cb) { this._listeners[name] = cb; }
  removeEventListener(name) { delete this._listeners[name]; }
  emit(name, arg) { const cb = this._listeners[name]; if (cb) cb(arg); }
}

/**
 * BleScale
 * @param {{bluetooth?: any}} options - provide a navigator.bluetooth-like object for injection (tests)
 */
export class BleScale extends SimpleEmitter {
  constructor(options = {}) {
    super();
    this.bluetooth = options.bluetooth || (typeof navigator !== 'undefined' && navigator.bluetooth);
    this.device = null;
    this.server = null;
    this.commandChar = null;
    this.weightChar = null;
    this._connected = false;
  }

  /**
   * Connect to a device exposing the service UUIDs. Returns the device name.
   * @param {{services: Array<number>}} opts
   */
  async connect(opts = { services: [SERVICE_UUID] }) {
    if (!this.bluetooth || !this.bluetooth.requestDevice) throw new Error('Bluetooth not available');
    const dev = await this.bluetooth.requestDevice({ filters: [{ services: opts.services }] });
    this.device = dev;
    if (dev.addEventListener) dev.addEventListener('gattserverdisconnected', () => this._onGattDisconnected());
    this.server = await dev.gatt.connect();
    const svc = await this.server.getPrimaryService(SERVICE_UUID);
    this.commandChar = await svc.getCharacteristic(COMMAND_CHAR_UUID);
    this.weightChar = await svc.getCharacteristic(WEIGHT_CHAR_UUID);
    if (this.weightChar.startNotifications) await this.weightChar.startNotifications();
    // forward incoming buffer events to our listeners
    if (this.weightChar.addEventListener) {
      this.weightChar.addEventListener('characteristicvaluechanged', (e) => {
        this.emit('value', e);
      });
    }
    this._connected = true;
    return { name: this.device && this.device.name };
  }

  async writeCommand(buffer) {
    if (!this.commandChar) throw new Error('No command characteristic');
    return this.commandChar.writeValue(buffer);
  }

  async disconnect() {
    if (this.server && typeof this.server.disconnect === 'function') {
      this.server.disconnect();
    }
    this._connected = false;
    this.emit('disconnect');
  }

  isConnected() { return !!this._connected; }

  _onGattDisconnected() {
    this._connected = false;
    this.emit('disconnect');
  }
}

/**
 * installMock - installs a test-only navigator.bluetooth mock and returns helpers
 * @returns {{uninstall: function():void, getWeightCharacteristic: function():Promise<any>}}
 */
export function installMock() {
  const original = typeof navigator !== 'undefined' ? navigator.bluetooth : undefined;
  // simple listener store for device events
  const listeners = {};

  class MockCharacteristic {
    constructor(uuid) { this.uuid = uuid; this._listeners = {}; }
    async startNotifications() { return; }
    addEventListener(ev, cb) { this._listeners[ev] = cb; }
    removeEventListener(ev) { delete this._listeners[ev]; }
    async writeValue(buf) { /* noop for tests */ }
    __emit(buffer) {
      const event = { target: { value: { buffer } } };
      const cb = this._listeners['characteristicvaluechanged'];
      if (cb) cb(event);
    }
  }

  class MockService {
    constructor() {
      this._chars = {};
      this._chars[COMMAND_CHAR_UUID] = new MockCharacteristic(COMMAND_CHAR_UUID);
      this._chars[WEIGHT_CHAR_UUID] = new MockCharacteristic(WEIGHT_CHAR_UUID);
    }
    async getCharacteristic(uuid) { return this._chars[uuid]; }
  }

  class MockGATTServer {
    constructor(device) { this.device = device; this._service = new MockService(); }
    async connect() { return this; }
    async getPrimaryService(uuid) { return this._service; }
    disconnect() { /* noop */ }
  }

  class MockDevice {
    constructor() { this.name = 'MockScale'; this.gatt = new MockGATTServer(this); }
    addEventListener(ev, cb) { listeners[ev] = cb; }
  }

  const sharedDevice = new MockDevice();
  const mock = { requestDevice: async (opts) => sharedDevice };

  // install mock
  if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'bluetooth', { value: mock, configurable: true });
  }

  return {
    uninstall: () => { if (typeof navigator !== 'undefined') Object.defineProperty(navigator, 'bluetooth', { value: original, configurable: true }); },
    getWeightCharacteristic: async () => {
      const dev = await mock.requestDevice();
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService(SERVICE_UUID);
      return svc._chars[WEIGHT_CHAR_UUID];
    }
  };
}
