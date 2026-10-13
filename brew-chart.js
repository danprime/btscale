/**
 * BrewChart - live line chart of the current brew, drawn on a canvas.
 *
 * Plots either EC (mS/cm, fixed 0-5 axis that stretches if a reading goes
 * higher) or weight (g, with an optional dashed target line). In EC mode,
 * `weightPoints` adds weight as a second, thinner line with its own axis on
 * the right. The time axis always spans the whole brew, from Start to now
 * (at least 30 s).
 *
 * The chart pulls its data from a callback on every draw:
 *   () => ({ mode: 'ec'|'weight', points: [{t, v}], weightPoints?: [{t, v}], elapsed, target, running })
 */

const EC_AXIS_MAX = 5;
const MIN_SPAN_S = 30;
const COLORS = {
  grid: '#f3e2c4',
  axisText: '#b77b2b',
  line: '#b45309',
  fillTop: 'rgba(183, 123, 43, 0.22)',
  fillBottom: 'rgba(183, 123, 43, 0)',
  target: '#256029',
  weight: '#8d6e63',
  hint: '#c9a46c',
};

const MODES = {
  ec: { unit: 'mS/cm', hint: 'EC will plot when the timer starts' },
  weight: { unit: 'g', hint: 'Weight will plot when the timer starts' },
};

export function formatSeconds(s) {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Round up to a "nice" axis maximum (1, 2, 2.5, 4, 5 x 10^n). */
function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

export class BrewChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {() => {mode: string, points: Array<{t:number, v:number}>, elapsed: number, target?: number|null, running?: boolean}} getData
   */
  constructor(canvas, getData) {
    this.canvas = canvas;
    this.getData = getData;
    this._pending = false;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.requestDraw()).observe(canvas);
    }
  }

  /** Coalesce redraws into the next animation frame. */
  requestDraw() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this.draw(); });
  }

  draw() {
    const canvas = this.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { mode = 'ec', points = [], elapsed = 0, target = null, weightPoints = null } = this.getData() || {};
    // Second line: weight on its own right-hand axis (EC mode only)
    const dual = mode === 'ec' && Array.isArray(weightPoints);
    const pad = { left: 34, right: dual ? 40 : 12, top: 10, bottom: 22 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Axes ranges
    const maxV = points.reduce((m, p) => Math.max(m, p.v), 0);
    let yMax;
    if (mode === 'ec') yMax = maxV > EC_AXIS_MAX ? Math.ceil(maxV * 1.1) : EC_AXIS_MAX;
    else yMax = niceMax(Math.max(maxV * 1.1, target ? target * 1.05 : 0, 50));
    const lastT = Math.max(points.length ? points[points.length - 1].t : 0, dual && weightPoints.length ? weightPoints[weightPoints.length - 1].t : 0);
    const span = Math.max(elapsed, lastT, MIN_SPAN_S);
    const x = (t) => pad.left + (t / span) * plotW;
    const y = (v) => pad.top + (1 - Math.min(Math.max(v, 0), yMax) / yMax) * plotH;

    // Grid + labels
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.axisText;
    const yStep = mode === 'ec' ? (yMax <= 6 ? 1 : 2) : niceMax(yMax / 5);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke();
      ctx.fillText(Number.isInteger(v) ? String(v) : v.toFixed(1), pad.left - 6, yy);
    }
    const xStep = span <= 60 ? 15 : span <= 180 ? 30 : span <= 600 ? 60 : 120;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= span + 1e-9; t += xStep) {
      const xx = Math.round(x(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, pad.top); ctx.lineTo(xx, pad.top + plotH); ctx.stroke();
      ctx.fillText(formatSeconds(t), Math.min(Math.max(xx, pad.left + 10), w - pad.right - 12), pad.top + plotH + 6);
    }

    // Target line (weight mode)
    if (mode === 'weight' && target && target > 0) {
      const ty = Math.round(y(target)) + 0.5;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = COLORS.target;
      ctx.beginPath(); ctx.moveTo(pad.left, ty); ctx.lineTo(w - pad.right, ty); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = COLORS.target;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`target ${Math.round(target)} g`, w - pad.right - 2, ty - 3);
    }

    // Weight line (dual mode): thinner, no fill, right axis in grams
    if (dual) {
      const wMax = niceMax(Math.max(weightPoints.reduce((m, p) => Math.max(m, p.v), 0) * 1.1, target ? target * 1.05 : 0, 50));
      const wy = (v) => pad.top + (1 - Math.min(Math.max(v, 0), wMax) / wMax) * plotH;
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = COLORS.weight;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const wStep = niceMax(wMax / 5);
      for (let v = 0; v <= wMax + 1e-9; v += wStep) ctx.fillText(String(v), w - pad.right + 6, wy(v));
      if (target && target > 0) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = COLORS.weight;
        ctx.globalAlpha = 0.6;
        const ty = Math.round(wy(target)) + 0.5;
        ctx.beginPath(); ctx.moveTo(pad.left, ty); ctx.lineTo(w - pad.right, ty); ctx.stroke();
        ctx.restore();
      }
      if (weightPoints.length) {
        ctx.save();
        ctx.strokeStyle = COLORS.weight;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        weightPoints.forEach((p, i) => (i ? ctx.lineTo(x(p.t), wy(p.v)) : ctx.moveTo(x(p.t), wy(p.v))));
        ctx.stroke();
        ctx.restore();
      }
    }

    if (!points.length) {
      ctx.fillStyle = COLORS.hint;
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((MODES[mode] || MODES.ec).hint, pad.left + plotW / 2, pad.top + plotH / 2);
      this._label(mode, null, dual ? weightPoints[weightPoints.length - 1] : null);
      return;
    }

    // Area fill + line
    const path = new Path2D();
    points.forEach((p, i) => (i ? path.lineTo(x(p.t), y(p.v)) : path.moveTo(x(p.t), y(p.v))));
    const area = new Path2D(path);
    area.lineTo(x(lastT), pad.top + plotH);
    area.lineTo(x(points[0].t), pad.top + plotH);
    area.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, COLORS.fillTop);
    grad.addColorStop(1, COLORS.fillBottom);
    ctx.fillStyle = grad;
    ctx.fill(area);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(path);

    // Latest point
    const last = points[points.length - 1];
    ctx.fillStyle = COLORS.line;
    ctx.beginPath(); ctx.arc(x(last.t), y(last.v), 3.5, 0, Math.PI * 2); ctx.fill();
    this._label(mode, last, dual ? weightPoints[weightPoints.length - 1] : null);
  }

  _label(mode, last, lastWeight) {
    const unit = (MODES[mode] || MODES.ec).unit;
    const name = mode === 'ec' ? 'EC' : 'Weight';
    const text = last
      ? `${name} chart, latest ${last.v.toFixed(mode === 'ec' ? 2 : 1)} ${unit} at ${formatSeconds(last.t)}`
      : `${name} chart, no data yet`;
    const full = lastWeight ? `${text}; weight ${lastWeight.v.toFixed(1)} g` : text;
    if (this.canvas.getAttribute('aria-label') !== full) this.canvas.setAttribute('aria-label', full);
  }
}

export default BrewChart;
