/**
 * BrewChart - live line chart of the current brew, drawn on a canvas.
 *
 * Plots either EC (mS/cm, fixed 0-5 axis that stretches if a reading goes
 * higher) or weight (g, with an optional dashed target line). In EC mode,
 * `weightPoints` adds weight as a second, thinner line; weight's axis stays on
 * the left (as in weight-only mode) and EC's axis moves to the right. The time axis always spans the whole brew, from Start to now
 * (at least 30 s).
 *
 * The chart pulls its data from a callback on every draw:
 *   () => ({ mode: 'ec'|'weight', points: [{t, v}], weightPoints?: [{t, v}], elapsed, target, running, hint? })
 * `hint` overrides the text shown while there's no data ('' shows none).
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
  ec: { unit: 'mS/cm', hint: 'Press Start' },
  weight: { unit: 'g', hint: 'Press Start' },
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
    // Android Chrome can discard a canvas while the app is in the background or covered;
    // redraw when it comes back, since a stopped brew gets no new readings to trigger one
    canvas.addEventListener('contextrestored', () => this.requestDraw());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.requestDraw(); });
    window.addEventListener('pageshow', () => this.requestDraw());
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

    const { mode = 'ec', points = [], elapsed = 0, target = null, weightPoints = null, hint = null } = this.getData() || {};
    // EC mode with a scale: weight is a second line. Weight's axis stays on the
    // left (as in weight-only mode) and EC's axis goes on the right.
    const dual = mode === 'ec' && Array.isArray(weightPoints);
    const pad = { left: 34, right: dual ? 28 : 12, top: 10, bottom: 22 };
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

    // Weight scale for the second line (dual mode)
    const wMax = dual ? niceMax(Math.max(weightPoints.reduce((m, p) => Math.max(m, p.v), 0) * 1.1, target ? target * 1.05 : 0, 50)) : null;
    const wy = (v) => pad.top + (1 - Math.min(Math.max(v, 0), wMax) / wMax) * plotH;

    // Grid + labels. Left axis: weight in dual mode, otherwise the main series.
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.grid;
    const yStep = mode === 'ec' ? (yMax <= 6 ? 1 : 2) : niceMax(yMax / 5);
    const left = dual
      ? { max: wMax, step: niceMax(wMax / 5), at: wy, color: COLORS.weight }
      : { max: yMax, step: yStep, at: y, color: COLORS.axisText };
    ctx.fillStyle = left.color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= left.max + 1e-9; v += left.step) {
      const yy = Math.round(left.at(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke();
      ctx.fillText(Number.isInteger(v) ? String(v) : v.toFixed(1), pad.left - 6, yy);
    }
    if (dual) {
      // EC axis on the right, in the EC line's colour
      ctx.fillStyle = COLORS.line;
      ctx.textAlign = 'left';
      for (let v = 0; v <= yMax + 1e-9; v += yStep) ctx.fillText(String(v), w - pad.right + 6, y(v));
    }
    ctx.fillStyle = COLORS.axisText;
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

    // Weight line (dual mode): thinner, no fill, on the left (grams) axis
    if (dual) {
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
      const text = hint ?? (MODES[mode] || MODES.ec).hint;
      if (!text) {
        this._label(mode, null, dual ? weightPoints[weightPoints.length - 1] : null, null);
        return;
      }
      // Shrink the hint (down to 11px) so long messages fit narrow phones
      let size = 13;
      ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
      while (size > 11 && ctx.measureText(text).width > plotW - 12) {
        size -= 0.5;
        ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
      }
      ctx.fillStyle = COLORS.hint;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pad.left + plotW / 2, pad.top + plotH / 2, plotW - 12);
      this._label(mode, null, dual ? weightPoints[weightPoints.length - 1] : null, text);
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

  _label(mode, last, lastWeight, hint) {
    const unit = (MODES[mode] || MODES.ec).unit;
    const name = mode === 'ec' ? 'EC' : 'Weight';
    const text = last
      ? `${name} chart, latest ${last.v.toFixed(mode === 'ec' ? 2 : 1)} ${unit} at ${formatSeconds(last.t)}`
      : `${name} chart, no data yet${hint ? `. ${hint.replace(/\.$/, '')}` : ''}`;
    const full = lastWeight ? `${text}; weight ${lastWeight.v.toFixed(1)} g` : text;
    if (this.canvas.getAttribute('aria-label') !== full) this.canvas.setAttribute('aria-label', full);
  }
}

export default BrewChart;
