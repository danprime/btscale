/**
 * ScaleController - high level wrapper around BleScale that implements
 * Bookoo scale-specific commands and parsing of incoming weight data.
 *
 * Exposes connect/disconnect and high-level commands (tare, timer, beep, etc.)
 * and emits 'data' events with parsed scale data objects.
 */
import { BleScale, installMock as _installMock } from './ble-scale.js';
import { parseWeightData } from './scale-utils.js';

class SimpleEmitter {
  constructor() { this._listeners = Object.create(null); }
  addEventListener(name, cb) { this._listeners[name] = cb; }
  removeEventListener(name) { delete this._listeners[name]; }
  emit(name, arg) { const cb = this._listeners[name]; if (cb) cb(arg); }
}

export class ScaleController extends SimpleEmitter {
  /**
   * @param {{bluetooth?: any}} options
   */
  constructor(options = {}) {
    super();
    this.ble = options.ble || new BleScale({ bluetooth: options.bluetooth });
    this._onRaw = this._onRaw.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
    this._connected = false;
  }

  static installMock() {
    return _installMock();
  }

  async connect(opts = {}) {
    try {
      const info = await this.ble.connect(opts);
      this._connected = true;
      // subscribe to raw BLE events
      this.ble.addEventListener('value', this._onRaw);
      this.ble.addEventListener('disconnect', this._onDisconnect);
      this.emit('connected', info);
      return info;
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  _onRaw(ev) {
    try {
      // ev.target.value.buffer -> ArrayBuffer
      const buf = new Uint8Array(ev.target.value.buffer);
      this.emit('raw', buf);
      const parsed = parseWeightData(buf);
      if (parsed) this.emit('data', parsed);
    } catch (e) {
      this.emit('error', e);
    }
  }

  _onDisconnect() {
    this._connected = false;
    this.emit('disconnected');
  }

  async disconnect() {
    await this.ble.disconnect();
    this._connected = false;
    this.emit('disconnected');
  }

  isConnected() { return !!this._connected || this.ble.isConnected(); }

  // Raw write
  async writeRaw(buf) {
    return this.ble.writeCommand(buf);
  }

  // High-level commands: construct 6-byte commands consistent with existing app
  async tare() {
    const cmd = new Uint8Array([0x03, 0x0A, 0x01, 0x00, 0x00, 0x08]);
    return this.writeRaw(cmd);
  }

  async tareAndStart() {
    const cmd = new Uint8Array([0x03, 0x0A, 0x07, 0x00, 0x00, 0x00]);
    return this.writeRaw(cmd);
  }

  async startTimer() {
    const cmd = new Uint8Array([0x03, 0x0A, 0x04, 0x00, 0x00, 0x0A]);
    return this.writeRaw(cmd);
  }

  async stopTimer() {
    const cmd = new Uint8Array([0x03, 0x0A, 0x05, 0x00, 0x00, 0x0D]);
    return this.writeRaw(cmd);
  }

  async resetTimer() {
    const cmd = new Uint8Array([0x03, 0x0A, 0x06, 0x00, 0x00, 0x0C]);
    return this.writeRaw(cmd);
  }

  async setBeep(level) {
    const levelByte = parseInt(level);
    const checksum = 0x03 ^ 0x0A ^ 0x02 ^ levelByte ^ 0x00;
    const cmd = new Uint8Array([0x03, 0x0A, 0x02, levelByte, 0x00, checksum]);
    return this.writeRaw(cmd);
  }

  async setAutoOff(minutes) {
    const minutesByte = parseInt(minutes);
    const checksum = 0x03 ^ 0x0A ^ 0x03 ^ minutesByte ^ 0x00;
    const cmd = new Uint8Array([0x03, 0x0A, 0x03, minutesByte, 0x00, checksum]);
    return this.writeRaw(cmd);
  }

  async setFlowSmoothing(enabled) {
    const enabledByte = enabled ? 0x01 : 0x00;
    const checksum = 0x03 ^ 0x0A ^ 0x08 ^ enabledByte ^ 0x00;
    const cmd = new Uint8Array([0x03, 0x0A, 0x08, enabledByte, 0x00, checksum]);
    return this.writeRaw(cmd);
  }
}

export default ScaleController;
