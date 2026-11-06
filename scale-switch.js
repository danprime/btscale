/**
 * ScaleSwitch - the one "scale" the rest of the app talks to. It holds a driver
 * for each supported brand, uses the one that matches the device that was
 * picked, and passes that driver's events and commands through.
 */
import { SimpleEmitter } from './emitter.js';
import ScaleController from './bookoo-scale.js';
import { AcaiaScale, ACAIA_NAME_PREFIXES } from './acaia-scale.js';

const EVENTS = ['data', 'raw', 'connected', 'disconnected', 'error'];
const COMMANDS = ['tare', 'tareAndStart', 'startTimer', 'stopTimer', 'resetTimer', 'setBeep', 'setAutoOff', 'setFlowSmoothing', 'writeRaw'];

/** Which brand a picked or remembered device is, judged by its name. */
export function scaleBrandOf(device) {
  const name = String(device?.name || '').toUpperCase();
  return ACAIA_NAME_PREFIXES.some((p) => name.startsWith(p)) ? 'acaia' : 'bookoo';
}

export const BRAND_LABELS = { bookoo: 'BOOKOO', acaia: 'Acaia (needs verification)' };

export class ScaleSwitch extends SimpleEmitter {
  /** @param {{bluetooth?: any}} options */
  constructor(options = {}) {
    super();
    this.drivers = {
      bookoo: new ScaleController({ bluetooth: options.bluetooth }),
      acaia: new AcaiaScale({ bluetooth: options.bluetooth }),
    };
    this.brand = 'bookoo';
    for (const [brand, driver] of Object.entries(this.drivers)) {
      for (const ev of EVENTS) {
        driver.addEventListener(ev, (arg) => { if (brand === this.brand) this.emit(ev, arg); });
      }
    }
    for (const cmd of COMMANDS) {
      this[cmd] = (...args) => {
        const fn = this.active[cmd];
        return fn ? fn.apply(this.active, args) : Promise.reject(new Error(`${cmd} is not supported on this scale`));
      };
    }
  }

  get active() { return this.drivers[this.brand]; }

  get label() { return BRAND_LABELS[this.brand]; }

  async connect(opts = {}) {
    if (opts.device) this.brand = scaleBrandOf(opts.device);
    return this.active.connect(opts);
  }

  async disconnect() { return this.active.disconnect(); }

  isConnected() { return this.active.isConnected(); }
}

export default ScaleSwitch;
