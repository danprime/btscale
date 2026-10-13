/**
 * SimpleEmitter - minimal event emitter shared by the BLE device wrappers.
 *
 * Supports multiple listeners per event. `removeEventListener(name)` without a
 * callback removes every listener for that event (kept for backwards compatibility).
 */
export class SimpleEmitter {
  constructor() { this._listeners = Object.create(null); }

  addEventListener(name, cb) {
    (this._listeners[name] ||= new Set()).add(cb);
  }

  removeEventListener(name, cb) {
    if (!this._listeners[name]) return;
    if (cb) this._listeners[name].delete(cb);
    else delete this._listeners[name];
  }

  emit(name, arg) {
    const set = this._listeners[name];
    if (!set) return;
    for (const cb of [...set]) cb(arg);
  }
}

export default SimpleEmitter;
