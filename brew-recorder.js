/**
 * BrewRecorder - records samples from the scale and the EC meter while a brew
 * is running. One row is stored per incoming packet (from either device), with
 * the latest known values from the other device merged in.
 */
// TDS columns come last so existing column positions don't move
export const CSV_HEADER = 't_s,weight_g,flow_gps,temp_c,ec_mScm,source,ciy,tds_pct';

export class BrewRecorder {
  /** @param {{now?: () => number}} options - clock in ms (injectable for tests) */
  constructor(options = {}) {
    this.now = options.now || (() => performance.now());
    this.rows = [];
    this.running = false;
    this.startedAt = null; // wall-clock Date, used for the file name
    this._t0 = 0;
    this._t1 = null; // stop time (ms), null while running
    this._latest = { weight: null, flow: null, temp: null, ec: null, ciy: null, tds: null };
  }

  start() {
    this.rows = [];
    this._all = null; // every row, while a trim hides some
    this._end = null; // trimmed end (s)
    this.running = true;
    this.startedAt = new Date();
    this._t0 = this.now();
    this._t1 = null;
  }

  stop() {
    if (this.running) this._t1 = this.now();
    this.running = false;
  }

  /** Seconds since start (frozen at the stop time once stopped; the trimmed end if trimmed). */
  elapsed() {
    if (this.startedAt == null) return 0;
    return this._end ?? this.fullElapsed();
  }

  /** Seconds from start to Stop, ignoring any trim. */
  fullElapsed() {
    if (this.startedAt == null) return 0;
    return ((this._t1 ?? this.now()) - this._t0) / 1000;
  }

  /** True while a trim hides the end of the brew. */
  get trimmed() { return this._end != null; }

  /** Every recorded row, including any a trim has cut off. */
  allRows() { return this._all ?? this.rows; }

  /**
   * After Stop: keep only the rows up to `t` seconds (Stop was pressed late). `null`, or a time
   * within half a second of Stop (the end is set in whole seconds), restores them all. The cut
   * rows are kept until the next Start, so a trim can be changed or undone.
   */
  setEnd(t) {
    const all = this.allRows();
    if (t == null || t >= this.fullElapsed() - 0.5) {
      this.rows = all;
      this._all = null;
      this._end = null;
    } else {
      this._all = all;
      this.rows = all.filter((r) => r.t <= t);
      this._end = t;
    }
  }

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

  /** TDS values (CIY, TDS %) to store with the next rows; null clears them. */
  setDerived({ ciy = null, tds = null } = {}) {
    Object.assign(this._latest, { ciy, tds });
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
    const lines = this.rows.map((r) => [f(r.t, 2), f(r.weight, 1), f(r.flow, 2), f(r.temp, 1), f(r.ec, 3), r.source, f(r.ciy, 2), f(r.tds, 3)].join(','));
    return [CSV_HEADER, ...lines].join('\n') + '\n';
  }

  fileName() {
    const d = this.startedAt || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `brew-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`;
  }
}

export default BrewRecorder;
