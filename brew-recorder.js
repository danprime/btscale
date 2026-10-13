/**
 * BrewRecorder - records samples from the scale and the EC meter while a brew
 * is running. One row is stored per incoming packet (from either device), with
 * the latest known values from the other device merged in.
 */
export const CSV_HEADER = 't_s,weight_g,flow_gps,temp_c,ec_mScm,source';

export class BrewRecorder {
  /** @param {{now?: () => number}} options - clock in ms (injectable for tests) */
  constructor(options = {}) {
    this.now = options.now || (() => performance.now());
    this.rows = [];
    this.running = false;
    this.startedAt = null; // wall-clock Date, used for the file name
    this._t0 = 0;
    this._latest = { weight: null, flow: null, temp: null, ec: null };
  }

  start() {
    this.rows = [];
    this.running = true;
    this.startedAt = new Date();
    this._t0 = this.now();
  }

  stop() { this.running = false; }

  hasData() { return this.rows.length > 0; }

  /** Track latest values even when not recording, so the first row is complete. */
  addScale({ weight, flowRate }) {
    this._latest.weight = weight;
    this._latest.flow = flowRate;
    this._push('scale');
  }

  addPortal({ temp, ec }) {
    this._latest.temp = temp;
    this._latest.ec = ec;
    this._push('portal');
  }

  /** Forget a device's values (e.g. after it disconnects). */
  clearSource(source) {
    if (source === 'scale') { this._latest.weight = null; this._latest.flow = null; }
    if (source === 'portal') { this._latest.temp = null; this._latest.ec = null; }
  }

  _push(source) {
    if (!this.running) return;
    this.rows.push({ t: (this.now() - this._t0) / 1000, ...this._latest, source });
  }

  toCSV() {
    const f = (v, digits) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(digits));
    const lines = this.rows.map((r) => [f(r.t, 2), f(r.weight, 1), f(r.flow, 2), f(r.temp, 1), f(r.ec, 3), r.source].join(','));
    return [CSV_HEADER, ...lines].join('\n') + '\n';
  }

  fileName() {
    const d = this.startedAt || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `brew-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`;
  }
}

export default BrewRecorder;
