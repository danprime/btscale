/**
 * BleScale - small wrapper around navigator.bluetooth for the BOOKOO scale.
 *
 * Provides a predictable API for connecting, receiving notifications, writing
 * commands, and installing a test-only mock for Playwright tests.
 *
 * This file is ESM and exports the BleScale class and an `installMock` helper.
 */

import { SimpleEmitter } from './emitter.js';
import { installMockBluetooth } from './ble-mock.js';

// Service and characteristic UUIDs (numeric form to match existing code)
export const SERVICE_UUID = 0x0FFE;
const COMMAND_CHAR_UUID = 0xFF12;
const WEIGHT_CHAR_UUID = 0xFF11;

/**
 * BleScale
 * @param {{bluetooth?: any}} options - provide a navigator.bluetooth-like object for injection (tests)
 */
export class BleScale extends SimpleEmitter {
  constructor(options = {}) {
    super();
    // Resolved lazily at connect time so a mock installed later is picked up.
    this.bluetooth = options.bluetooth || null;
    this.device = null;
    this.server = null;
    this.commandChar = null;
    this.weightChar = null;
    this._connected = false;
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  /**
   * Connect to the scale. Pass `device` to connect to an already-chosen device
   * (e.g. a remembered one from getDevices()); otherwise a picker is shown.
   * Returns the device name.
   * @param {{services?: Array<number>, device?: any}} opts
   */
  async connect(opts = {}) {
    const bluetooth = this.bluetooth || (typeof navigator !== 'undefined' && navigator.bluetooth);
    let dev = opts.device;
    if (!dev) {
      if (!bluetooth || !bluetooth.requestDevice) throw new Error('Bluetooth not available');
      dev = await bluetooth.requestDevice({ filters: [{ services: opts.services || [SERVICE_UUID] }] });
    }
    if (this.device && this.device !== dev && this.device.removeEventListener) {
      this.device.removeEventListener('gattserverdisconnected', this._onGattDisconnected);
    }
    this.device = dev;
    if (dev.addEventListener) {
      dev.removeEventListener?.('gattserverdisconnected', this._onGattDisconnected);
      dev.addEventListener('gattserverdisconnected', this._onGattDisconnected);
    }
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
    const wasConnected = this._connected;
    this._connected = false;
    if (this.server && typeof this.server.disconnect === 'function') {
      this.server.disconnect();
    }
    if (wasConnected) this.emit('disconnect');
  }

  isConnected() { return !!this._connected; }

  _onGattDisconnected() {
    if (!this._connected) return;
    this._connected = false;
    this.emit('disconnect');
  }
}

/**
 * installMock - installs a test-only navigator.bluetooth mock exposing a single
 * scale and returns helpers.
 * @returns {{uninstall: function():void, getWeightCharacteristic: function():Promise<any>}}
 */
export function installMock() {
  return installMockBluetooth({ devices: ['scale'] });
}
