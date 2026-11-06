/**
 * AcaiaScale - driver for the older generation of Acaia scales, with the same
 * surface as ScaleController (BOOKOO) so the rest of the app can use either.
 *
 * Needs verification: only tested against a fake scale (see acaia-protocol.js).
 *
 * Differences from the BOOKOO scale:
 * - The scale does not report its timer or flow in the weight packets, so this
 *   driver keeps the brew time itself (started and stopped with the timer
 *   commands) and works the flow out from the weight over the last second.
 * - There is no battery reading yet, no beep, auto-off or flow smoothing setting.
 * - The scale only sends weight when asked, so it is asked once a second.
 */
import { SimpleEmitter } from './emitter.js';
import {
  ACAIA_SERVICE_UUID,
  ACAIA_CHARACTERISTIC_UUID,
  MessageType,
  decode,
  encodeWeightRequest,
  encodeTare,
  encodeStartTimer,
  encodeStopTimer,
} from './acaia-protocol.js';

export { ACAIA_SERVICE_UUID };
export const ACAIA_NAME_PREFIXES = ['ACAIA', 'PEARL', 'LUNAR', 'PYXIS', 'PROCH'];
const POLL_MS = 1000;
const FLOW_WINDOW_MS = 1000;

function unsupported(what) {
  return () => Promise.reject(new Error(`${what} is not supported on this scale`));
}

export class AcaiaScale extends SimpleEmitter {
  /** @param {{bluetooth?: any, now?: () => number}} options */
  constructor(options = {}) {
    super();
    this.bluetooth = options.bluetooth || null;
    this.now = options.now || (() => Date.now());
    this.device = null;
    this.char = null;
    this._connected = false;
    this._seq = 0;
    this._poll = null;
    this._samples = [];
    this._timerStart = null; // when the timer last started running
    this._timerBase = 0;     // time banked before it last stopped
    this._onValue = this._onValue.bind(this);
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  elapsedMs() {
    return this._timerBase + (this._timerStart != null ? this.now() - this._timerStart : 0);
  }

  async connect(opts = {}) {
    try {
      const bluetooth = this.bluetooth || (typeof navigator !== 'undefined' && navigator.bluetooth);
      let dev = opts.device;
      if (!dev) {
        if (!bluetooth || !bluetooth.requestDevice) throw new Error('Bluetooth not available');
        dev = await bluetooth.requestDevice({ filters: [{ services: [ACAIA_SERVICE_UUID] }] });
      }
      this.device = dev;
      dev.removeEventListener?.('gattserverdisconnected', this._onGattDisconnected);
      dev.addEventListener?.('gattserverdisconnected', this._onGattDisconnected);
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService(ACAIA_SERVICE_UUID);
      this.char = await svc.getCharacteristic(ACAIA_CHARACTERISTIC_UUID);
      if (this.char.startNotifications) await this.char.startNotifications();
      this.char.removeEventListener?.('characteristicvaluechanged', this._onValue);
      this.char.addEventListener?.('characteristicvaluechanged', this._onValue);
      this._connected = true;
      this._samples = [];
      await this._requestWeight();
      this._poll = setInterval(() => this._requestWeight().catch(() => {}), POLL_MS);
      const info = { name: dev.name };
      this.emit('connected', info);
      return info;
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  _write(bytes) {
    if (!this.char) return Promise.reject(new Error('No scale characteristic'));
    return this.char.writeValue(bytes);
  }

  _next() { const s = this._seq; this._seq = (this._seq + 1) & 0xff; return s; }

  _requestWeight() { return this._write(encodeWeightRequest(this._next())); }

  _onValue(ev) {
    try {
      const v = ev.target.value;
      const buf = new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength ?? v.buffer.byteLength);
      this.emit('raw', buf);
      const msg = decode(buf);
      if (!msg || msg.type !== MessageType.WEIGHT_RESPONSE || msg.weight == null) return;
      const t = this.now();
      this._samples.push({ t, w: msg.weight });
      while (this._samples.length > 1 && t - this._samples[0].t > FLOW_WINDOW_MS) this._samples.shift();
      const first = this._samples[0];
      const flowRate = t > first.t ? (msg.weight - first.w) / ((t - first.t) / 1000) : 0;
      this.emit('data', {
        milliseconds: this.elapsedMs(),
        weight: msg.weight,
        flowRate,
        batteryPercent: null,
      });
    } catch (e) {
      this.emit('error', e);
    }
  }

  _onGattDisconnected() { this._handleDisconnect(); }

  _handleDisconnect() {
    clearInterval(this._poll);
    this._poll = null;
    if (!this._connected) return;
    this._connected = false;
    this.emit('disconnected');
  }

  async disconnect() {
    this.device?.gatt?.disconnect?.();
    this._handleDisconnect();
  }

  isConnected() { return !!this._connected; }

  async tare() { return this._write(encodeTare(this._next())); }

  async startTimer() {
    await this._write(encodeStartTimer(this._next()));
    if (this._timerStart == null) this._timerStart = this.now();
  }

  async stopTimer() {
    await this._write(encodeStopTimer(this._next()));
    if (this._timerStart != null) {
      this._timerBase = this.elapsedMs();
      this._timerStart = null;
    }
  }

  async resetTimer() {
    await this._write(encodeStopTimer(this._next()));
    this._timerStart = null;
    this._timerBase = 0;
  }

  async tareAndStart() {
    await this.tare();
    this._timerStart = null;
    this._timerBase = 0;
    await this.startTimer();
  }

  setBeep = unsupported('Beep level');
  setAutoOff = unsupported('Auto-off');
  setFlowSmoothing = unsupported('Flow smoothing');
}

export default AcaiaScale;
