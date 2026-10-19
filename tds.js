/**
 * TDS from the EC meter + scale.
 *
 * Cumulative Ionic Yield (CIY): EC summed over the water poured (a Riemann
 * sum over volume, 1 g of water ≈ 1 mL):
 *   CIY += EC × ΔV              (one step per EC reading)
 * The Portal's EC is already temperature-compensated to 25 °C on the device
 * (EC = calibrated reading / (1 + tempCal_k × (T − 25)), see getTemporalEc in
 * the Belka app), so it is used as-is.
 * TDS and the calibration constant k_v:
 *   TDS % = 100 × k_v × CIY / yield
 *   k_v   = TDS % × yield / (100 × CIY)
 */
export const DEFAULT_KV = 0.005; // rough k_v until the first refractometer calibration
export const DEFAULT_ABSORPTION = 2.0; // g of water held per g of coffee
export const MAX_ABSORPTION = 5;

/** Estimated liquid yield: water poured minus what the coffee bed holds back. */
export function liveYield(poured, dose, absorption) {
  if (!Number.isFinite(poured)) return null;
  return poured - (dose > 0 ? dose : 0) * (Number.isFinite(absorption) && absorption > 0 ? absorption : 0);
}

/** TDS % from k_v, CIY and a yield in grams; null when any input is missing. */
export function tdsPercent(kv, ciy, yieldG) {
  if (!(kv > 0) || !(ciy > 0) || !(yieldG > 0)) return null;
  return (100 * kv * ciy) / yieldG;
}

/** Extraction yield % = yield in the cup (g) x TDS % / dry coffee dose (g). */
export function extractionYield(yieldG, tdsPct, dose) {
  if (!(yieldG > 0) || !(tdsPct > 0) || !(dose > 0)) return null;
  return (yieldG * tdsPct) / dose;
}

/**
 * Brew control chart regions (gold cup: 1.15–1.35 % TDS, 18–22 % extraction).
 * Returns e.g. "Ideal (gold cup)", "Strong / under-extracted".
 */
export function extractionRegion(tdsPct, ey) {
  if (!(tdsPct > 0) || !(ey > 0)) return null;
  const strength = tdsPct > 1.35 ? 'Strong' : tdsPct < 1.15 ? 'Weak' : null;
  const extraction = ey > 22 ? 'over-extracted' : ey < 18 ? 'under-extracted' : null;
  if (!strength && !extraction) return 'Ideal (gold cup)';
  if (!strength) return `Balanced strength, ${extraction}`;
  if (!extraction) return `${strength}, balanced extraction`;
  return `${strength} / ${extraction}`;
}

/** Calibration constant from a refractometer TDS %, the yield and the CIY. */
export function calcKv(tdsPct, yieldG, ciy) {
  if (!(tdsPct > 0) || !(yieldG > 0) || !(ciy > 0)) return null;
  return (tdsPct * yieldG) / (100 * ciy);
}

/**
 * Accumulates CIY during a brew. ΔV is measured against the highest weight
 * seen so far, so scale noise or a bumped scale never counts water twice.
 */
export class CiyIntegrator {
  constructor() { this.reset(); }

  /** @param {number|null} baseline - weight on the scale when the brew starts */
  reset(baseline = null) {
    this.ciy = 0;
    this.steps = 0;
    this.baseline = Number.isFinite(baseline) ? baseline : null;
    this.highWater = this.baseline;
    this.weight = this.baseline;
  }

  /** Latest scale weight. */
  addWeight(weight) {
    if (!Number.isFinite(weight)) return;
    this.weight = weight;
    if (this.baseline == null) this.baseline = this.highWater = weight; // first reading is the baseline
  }

  /** Water poured since the start, in grams (null before any weight). */
  get poured() {
    return this.weight == null ? null : this.weight - this.baseline;
  }

  /** One EC reading (already at 25 °C): adds EC × the water poured since the previous reading. */
  addEc(ec) {
    if (!Number.isFinite(ec) || this.weight == null) return;
    const dV = Math.max(0, this.weight - this.highWater);
    this.highWater = Math.max(this.highWater, this.weight);
    this.ciy += ec * dV;
    this.steps++;
  }
}
