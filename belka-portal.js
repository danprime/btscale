/**
 * BelkaPortal - Web Bluetooth driver for the Belka PORTAL EC (electrical conductivity) meter.
 *
 * Protocol (reverse-engineered from the Belka app, see belka_portal_protocol.md):
 * - Advertised name "BelkaPortal", service 0x7400.
 * - 0x7410 (notify): 13-byte stream packet, little-endian:
 *     [0..3] EC mS/cm (float32), [4..7] internal temp °C (float32),
 *     [8..11] spout temp °C (float32), [12] battery % (uint8)
 * - 0x7420 (write): 40 00 01 2D = start device timer (beeps), 40 00 01 2E = stop.
 *
 * Emits: 'connected' ({name}), 'data' (parsed packet), 'raw' (Uint8Array), 'disconnected', 'error'.
 */
import { SimpleEmitter } from './emitter.js';

export const PORTAL_NAME = 'BelkaPortal';
export const PORTAL_SERVICE_UUID = '00007400-0000-1000-8000-00805f9b34fb';
const STREAM_CHAR_UUID = '00007410-0000-1000-8000-00805f9b34fb';
const COMMAND_CHAR_UUID = '00007420-0000-1000-8000-00805f9b34fb';

export const PORTAL_CMD_START = [0x40, 0x00, 0x01, 0x2d];
export const PORTAL_CMD_STOP = [0x40, 0x00, 0x01, 0x2e];

/** requestDevice() filter matching the Portal. */
export const PORTAL_FILTER = { name: PORTAL_NAME };

/**
 * Parse a 0x7410 stream packet.
 * @param {Uint8Array|DataView|ArrayBuffer} data
 * @returns {{ec:number, internalTemp:number, temp:number, battery:number}|null}
 */
export function parsePortalPacket(data) {
  let dv;
  if (data instanceof DataView) dv = data;
  else if (data instanceof ArrayBuffer) dv = new DataView(data);
  else if (ArrayBuffer.isView(data)) dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  else return null;
  if (dv.byteLength < 13) return null;
  return {
    ec: dv.getFloat32(0, true),
    internalTemp: dv.getFloat32(4, true),
    temp: dv.getFloat32(8, true),
    battery: dv.getUint8(12),
  };
}

export class BelkaPortal extends SimpleEmitter {
  /** @param {{bluetooth?: any}} options - inject a navigator.bluetooth-like object (tests) */
  constructor(options = {}) {
    super();
    this.bluetooth = options.bluetooth || null;
    this.device = null;
    this.server = null;
    this.streamChar = null;
    this.commandChar = null;
    this._connected = false;
    this._onStream = this._onStream.bind(this);
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  /**
   * Connect to the Portal. Pass `device` to connect to an already-chosen device
   * (e.g. a remembered one); otherwise a picker is shown.
   * @param {{device?: any}} opts
   */
  async connect(opts = {}) {
    try {
      const bluetooth = this.bluetooth || (typeof navigator !== 'undefined' && navigator.bluetooth);
      let dev = opts.device;
      if (!dev) {
        if (!bluetooth || !bluetooth.requestDevice) throw new Error('Bluetooth not available');
        dev = await bluetooth.requestDevice({ filters: [PORTAL_FILTER], optionalServices: [PORTAL_SERVICE_UUID] });
      }
      if (this.device && this.device !== dev) this.device.removeEventListener?.('gattserverdisconnected', this._onGattDisconnected);
      this.device = dev;
      dev.removeEventListener?.('gattserverdisconnected', this._onGattDisconnected);
      dev.addEventListener?.('gattserverdisconnected', this._onGattDisconnected);

      this.server = await dev.gatt.connect();
      const svc = await this.server.getPrimaryService(PORTAL_SERVICE_UUID);
      this.streamChar = await svc.getCharacteristic(STREAM_CHAR_UUID);
      this.commandChar = await svc.getCharacteristic(COMMAND_CHAR_UUID);
      this.streamChar.removeEventListener?.('characteristicvaluechanged', this._onStream);
      this.streamChar.addEventListener('characteristicvaluechanged', this._onStream);
      await this.streamChar.startNotifications();

      this._connected = true;
      const info = { name: dev.name };
      this.emit('connected', info);
      return info;
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  _onStream(ev) {
    const v = ev.target.value;
    const raw = new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength ?? v.buffer.byteLength);
    this.emit('raw', raw);
    const parsed = parsePortalPacket(raw);
    if (parsed) this.emit('data', parsed);
  }

  async _write(bytes) {
    if (!this.commandChar) throw new Error('Portal not connected');
    const buf = new Uint8Array(bytes);
    const c = this.commandChar;
    if (c.properties?.writeWithoutResponse && c.writeValueWithoutResponse) return c.writeValueWithoutResponse(buf);
    if (c.writeValueWithResponse) return c.writeValueWithResponse(buf);
    return c.writeValue(buf);
  }

  /** Start the device's on-screen timer (device beeps). */
  startTimer() { return this._write(PORTAL_CMD_START); }

  /** Stop the device's on-screen timer (device beeps). */
  stopTimer() { return this._write(PORTAL_CMD_STOP); }

  async disconnect() {
    const wasConnected = this._connected;
    this._connected = false;
    try { this.server?.disconnect?.(); } catch {}
    if (wasConnected) this.emit('disconnected');
  }

  isConnected() { return this._connected; }

  _onGattDisconnected() {
    if (!this._connected) return;
    this._connected = false;
    this.emit('disconnected');
  }
}

export default BelkaPortal;
