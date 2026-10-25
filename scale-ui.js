// --- Memory Feature: Persistent Storage for Weights ---

const MEMORY_KEY = 'scaleMemoryV1';
let memory = {
  beans: null, // { weight: number }
  carafe: null // { weight: number }
};

function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (raw) memory = JSON.parse(raw);
  } catch {}
  updateMemoryTable();
}

function saveMemory() {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  updateMemoryTable();
  sync?.schedule();
}

// Settings rows for the stored weights (typed in; the scale is not used here)
const MEMORY_ROWS = {
  beans: { cell: 'memoryBeansWeight', btn: 'memoryBeansEditBtn', label: 'Bean dose, grams' },
  carafe: { cell: 'memoryCarafeWeight', btn: 'memoryCarafeEditBtn', label: 'Carafe or server weight, grams' },
};
const MAX_MEMORY_WEIGHT = 5000;

function updateMemoryTable() {
  recomputeTarget();
  for (const [key, row] of Object.entries(MEMORY_ROWS)) {
    const cell = document.getElementById(row.cell);
    if (!cell || cell.querySelector('input')) continue; // being edited
    cell.textContent = memory[key]?.weight != null ? `${Number(memory[key].weight.toFixed(1))} g` : '--';
  }
}

// Edit turns the stored weight into an input; Enter or Save stores it, Escape cancels
function startMemoryEdit(key) {
  const row = MEMORY_ROWS[key];
  const cell = document.getElementById(row.cell);
  const btn = document.getElementById(row.btn);
  if (!cell || !btn || cell.querySelector('input')) return;
  const current = memory[key]?.weight;
  const input = document.createElement('input');
  Object.assign(input, { type: 'number', min: '0', max: String(MAX_MEMORY_WEIGHT), step: 'any', inputMode: 'decimal', className: 'memory-input' });
  input.id = `${key}MemoryInput`;
  input.setAttribute('aria-label', row.label);
  input.value = current != null ? String(Number(current.toFixed(2))) : '';
  cell.replaceChildren(input);
  btn.textContent = 'Save';
  btn.onclick = () => saveMemoryEdit(key);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveMemoryEdit(key); }
    if (e.key === 'Escape') { e.stopPropagation(); endMemoryEdit(key); }
  });
  input.addEventListener('input', () => showMemoryError(''));
  input.focus();
  input.select();
}

function saveMemoryEdit(key) {
  const input = document.getElementById(`${key}MemoryInput`);
  if (!input) return;
  const w = input.value.trim() === '' ? NaN : Number(input.value);
  if (!(w > 0 && w <= MAX_MEMORY_WEIGHT)) {
    showMemoryError(`Enter a weight above 0 and up to ${MAX_MEMORY_WEIGHT} g.`);
    input.focus();
    return;
  }
  memory[key] = { weight: w };
  endMemoryEdit(key);
  saveMemory();
}

function endMemoryEdit(key) {
  const row = MEMORY_ROWS[key];
  const cell = document.getElementById(row.cell);
  const btn = document.getElementById(row.btn);
  if (cell) cell.replaceChildren();
  if (btn) { btn.textContent = 'Edit'; btn.onclick = () => startMemoryEdit(key); }
  showMemoryError('');
  updateMemoryTable();
}

function showMemoryError(msg) {
  const el = document.getElementById('memoryError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

window.startMemoryEdit = startMemoryEdit;

window.addEventListener('DOMContentLoaded', () => {
  loadMemory();
});
// Import utility functions for testability
import { calculateChecksum, verifyChecksum, parseWeightData } from './scale-utils.js';
import { installMock } from './ble-scale.js';
import { installMockBluetooth } from './ble-mock.js';
import { DeviceManager } from './device-manager.js';
import { BrewRecorder } from './brew-recorder.js';
import { BrewChart, formatSeconds } from './brew-chart.js';
import { BrewLog, downsample, MAX_BREWS } from './brew-log.js';
import { Sync, SYNCED_SETTINGS } from './sync.js';
import { CiyIntegrator, liveYield, tdsPercent, calcKv, extractionYield, extractionRegion, DEFAULT_KV, DEFAULT_ABSORPTION, MAX_ABSORPTION } from './tds.js';

// --- Settings modal logic (moved to top for global availability) ---
function openSettingsModal() {
    document.getElementById('settingsModal').style.display = 'block';
}
function closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
    refreshChart(); // the canvas may have been discarded while covered
}
function setFlowSymbol(symbol) {
    document.getElementById('flowSymbol').textContent = symbol;
}

// Both BLE devices (scale + Belka Portal EC meter) are owned by the DeviceManager.
const devices = new DeviceManager();
window.__devices = devices;
window.__scaleController = devices.scale; // kept for existing callers/tests

let isConnected = false; // true when at least one device is connected
let packetCount = 0;
let targetWeight = null;
let timerRunning = false;
let timerLocked = false;
let timerState = 'stopped'; // Global timerState declaration

// Brew recording (weight, flow, temperature, EC) between Start and Stop
const recorder = new BrewRecorder();
let lastScaleData = null;
let lastPortalData = null;
// Final values captured at Stop; while set, the main readouts stay frozen
let finalSnapshot = null;
// Trim (after Stop, if Stop was pressed late): the values at Stop, and the end being chosen
let fullSnapshot = null;
let trimMode = false;
let trimEnd = null; // s
let trimBefore = null; // the end in use when trim mode opened (null = the full brew)

// TDS (needs the scale and the EC meter): CIY accumulates while a brew runs with both
const ciy = new CiyIntegrator();
let sync = null; // settings and brew log shared between devices (set up with the brew log)
let tdsBrew = false; // true once this brew has summed EC over poured water
let tdsMinSeconds = 30; // live TDS shows "--" for this long after Start
let finalTds = null; // { yieldG, tds } from the final TDS calculator, after Stop

// Tablet (iPad, landscape or portrait): all nine readings, both charts at once, the brew log as list + detail
const TABLET_QUERY = window.matchMedia?.('(min-width: 1024px) and (min-height: 700px) and (orientation: landscape), (min-width: 768px) and (min-height: 1000px) and (orientation: portrait)');
function isTablet() { return !!TABLET_QUERY?.matches; }

// Live brew chart (replaces the progress ring). Cleared on Reset, refilled from Start.
let brewChart = null;
let chartCleared = true;

function chartData() {
    const rows = chartCleared ? [] : recorder.rows;
    const mode = rows.some((r) => r.source === 'portal') || deviceConnected('portal') ? 'ec' : 'weight';
    const points = [];
    for (const r of rows) {
        if (mode === 'ec' && r.source === 'portal' && r.ec != null) points.push({ t: r.t, v: r.ec });
        else if (mode === 'weight' && r.source === 'scale' && r.weight != null) points.push({ t: r.t, v: r.weight });
    }
    // In EC mode, weight is drawn as a second line on its own axis
    // ...only when there's a scale (connected, or weights in this brew)
    const scaleRows = rows.filter((r) => r.source === 'scale' && r.weight != null);
    const weightPoints = mode === 'ec' && (deviceConnected('scale') || scaleRows.length)
        ? scaleRows.map((r) => ({ t: r.t, v: r.weight }))
        : null;
    // Nothing connected: no hint text, the Connect button sits in the empty chart instead
    const hint = deviceConnected('scale') || deviceConnected('portal') ? 'Press Start' : '';
    return { mode, points, weightPoints, elapsed: chartCleared ? 0 : recorder.elapsed(), target: targetWeight, running: recorder.running, hint, valuesAt: trimMode ? trimEnd : null };
}

function refreshChart() {
    if (!brewChart) return;
    const label = document.getElementById('brewChartLabel');
    const { mode, weightPoints } = chartData();
    // Weight's label stays on the left; with the EC meter, EC's is on the right
    const html = mode !== 'ec'
        ? '<span class="brew-chart-label-weight">Weight · g</span>'
        : weightPoints
            ? '<span class="brew-chart-label-weight">Weight · g</span><span class="brew-chart-label-ec">EC · mS/cm</span>'
            : '<span class="brew-chart-label-ec">EC · mS/cm</span>'; // EC only: its axis is the left one
    if (label && label.innerHTML !== html) label.innerHTML = html;
    brewChart.requestDraw();
}

const READING_UNIT = /^(.*\S)( (?:g\/s|g|°C|%|mS\/cm))$/;
function unitizeReading(el) {
    if (el.querySelector('em')) return;
    const m = el.textContent.match(READING_UNIT);
    if (!m) return;
    el.textContent = m[1];
    el.append(Object.assign(document.createElement('em'), { textContent: m[2] }));
}

window.addEventListener('DOMContentLoaded', () => {
    const readings = document.getElementById('readings');
    if (readings) {
        readings.querySelectorAll('.ritual-info-value').forEach(unitizeReading);
        new MutationObserver((changes) => {
            for (const c of changes) {
                const el = c.target.nodeType === 1 ? c.target.closest('.ritual-info-value') : c.target.parentElement?.closest('.ritual-info-value');
                if (el) unitizeReading(el);
            }
        }).observe(readings, { childList: true, characterData: true, subtree: true });
    }
    const canvas = document.getElementById('brewChartCanvas');
    if (canvas) brewChart = new BrewChart(canvas, chartData);
    refreshChart();
});

// Test-only connection overrides (see __test_setConnected); null = use real state
const testConnected = { scale: null, portal: null };
// Throttled log implementation
let logBuffer = [];
let logScheduled = false;
const LOG_THROTTLE_MS = 200;
let logEnabled = true;

// Ensure logging toggle is initialized after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    const logToggle = document.getElementById('logToggle');
    const logPanel = document.getElementById('log');
    if (logToggle && logPanel) {
        logEnabled = logToggle.checked;
        logPanel.style.display = logEnabled ? '' : 'none';
        logToggle.addEventListener('change', (e) => {
            logEnabled = e.target.checked;
            logPanel.style.display = logEnabled ? '' : 'none';
        });
    }
    // Remainder panel logic
    const showRemainder = document.getElementById('showRemainder');
    const remainderPanel = document.getElementById('remainderPanel');
    if (showRemainder && remainderPanel) {
        remainderPanel.style.display = showRemainder.checked ? '' : 'none';
        showRemainder.addEventListener('change', (e) => {
            remainderPanel.style.display = e.target.checked ? '' : 'none';
        });
    }
    // Tare & Start button logic
    const showTareStart = document.getElementById('showTareStart');
    const tareStartBtn = document.getElementById('tareStartBtn');
    if (showTareStart && tareStartBtn) {
        tareStartBtn.style.display = showTareStart.checked ? '' : 'none';
        showTareStart.addEventListener('change', (e) => {
            tareStartBtn.style.display = e.target.checked ? '' : 'none';
        });
    }
    // Current Ratio panel logic
    const showCurrentRatio = document.getElementById('showCurrentRatio');
    const currentRatioPanel = document.getElementById('currentRatioPanel');
    if (showCurrentRatio && currentRatioPanel) {
        currentRatioPanel.style.display = showCurrentRatio.checked ? '' : 'none';
        showCurrentRatio.addEventListener('change', (e) => {
            currentRatioPanel.style.display = e.target.checked ? '' : 'none';
        });
    }
});

function log(message) {
    if (!logEnabled) return;
    const timestamp = new Date().toLocaleTimeString();
    logBuffer.push(`[${timestamp}] ${message}`);
    if (!logScheduled) {
        logScheduled = true;
        setTimeout(() => {
            const logElement = document.getElementById('log');
            // Limit to last 200 entries
            if (logBuffer.length > 200) logBuffer = logBuffer.slice(-200);
            logElement.innerHTML += logBuffer.join('<br>') + '<br>';
            logElement.scrollTop = logElement.scrollHeight;
            logBuffer = [];
            logScheduled = false;
        }, LOG_THROTTLE_MS);
    }
}

// --- Connection state ---
function deviceConnected(type) {
    return testConnected[type] ?? devices.isConnected(type);
}

const PLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-8 h-8 text-white ml-1"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;
const STOP_ICON = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square w-8 h-8 text-white"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
const RESET_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rotate-ccw w-6 h-6 text-amber-700"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`;

function renderTimerIcon() {
    const timerIcon = document.getElementById('timerBtnIcon');
    if (!timerIcon) return;
    timerIcon.innerHTML = timerState === 'running' ? STOP_ICON : timerState === 'reset-required' ? RESET_ICON : PLAY_ICON;
    // After Stop the controls become: Final TDS / Beans | Reset | CSV (Tare is in the calculator)
    document.querySelector('.ritual-main-actions')?.classList.toggle('is-stopped', timerState === 'reset-required');
}

/** Refresh every connection-dependent piece of UI from the current device state. */
function renderConnectionState(errorText) {
    const scaleOn = deviceConnected('scale');
    const portalOn = deviceConnected('portal');
    const any = scaleOn || portalOn;
    const all = scaleOn && portalOn;
    isConnected = any;

    // The header icons show what is connected; the status line is only used for errors.
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = errorText || '';
        statusElement.className = `status ${any ? 'connected' : 'disconnected'} ritual-status`;
        statusElement.style.display = errorText ? '' : 'none';
    }

    // One button: connect whatever is missing, or disconnect both when both are connected.
    const connectBtn = document.getElementById('connectToggleBtn');
    if (connectBtn) {
        connectBtn.textContent = all ? 'Disconnect' : scaleOn ? 'Connect EC meter' : portalOn ? 'Connect scale' : 'Connect';
        connectBtn.setAttribute('aria-pressed', String(all));
        connectBtn.disabled = false;
    }
    const disconnectAllBtn = document.getElementById('disconnectAllBtn');
    if (disconnectAllBtn) disconnectAllBtn.hidden = !(any && !all);

    // Header icons are always shown: solid when connected, faded (tap to connect) when not
    renderDeviceIcon('scaleIcon', 'Scale', scaleOn);
    renderDeviceIcon('portalIcon', 'EC meter', portalOn);
    renderDeviceRows();
    // Nothing connected and nothing recorded: a Connect button in the empty chart
    const chartConnect = document.getElementById('chartConnectBtn');
    const hasBrew = !chartCleared && recorder.hasData();
    if (chartConnect) chartConnect.hidden = any || hasBrew;
    // A stopped brew is on screen (chart kept): Connect goes under the chart instead of over it
    const stripConnect = document.getElementById('stripConnectBtn');
    if (stripConnect) stripConnect.hidden = any || !hasBrew;
    const portalInfo = document.getElementById('portalInfo');
    // Keep the frozen Temp/Peak EC cards after Stop even if the EC meter has gone
    if (portalInfo) portalInfo.style.display = portalOn || finalSnapshot?.peakEc != null || isTablet() ? '' : 'none';
    renderLiveStrip();

    // Scale-only controls
    for (const id of ['tareBtn', 'tareStartBtn', 'tareBeanBtn', 'beepLevel', 'autoOff', 'flowSmoothing', 'targetRatioBtn']) {
        const el = document.getElementById(id);
        if (el) el.disabled = !scaleOn;
    }
    renderBeanButton();
    renderTdsPanel();
    renderFinalTdsDialog();
    renderExtractionChart();

    // The timer works with either device (the app keeps its own clock as a fallback).
    const timerBtn = document.getElementById('timerToggleBtn');
    // Reset needs no device (it clears the app); Start/Stop does
    if (timerBtn) timerBtn.disabled = !any && timerState !== 'reset-required';
    if (!any && timerState === 'running') {
        // Everything dropped mid-brew: stop locally and keep what was recorded.
        appTimer.stop();
        recorder.stop();
        timerState = 'reset-required';
        captureFinal();
        releaseWakeLock();
    }
    renderBeanButton();
    renderTimerIcon();
    updateExportButton();
    refreshChart();
}

/** Settings > Devices: one row per device with its state and battery. */
function renderDeviceRows() {
    const rows = [
        ['scale', 'scaleRowState', 'scaleRowSub', 'BOOKOO', lastScaleData?.batteryPercent],
        ['portal', 'portalRowState', 'portalRowSub', 'Belka PORTAL', lastPortalData?.battery],
    ];
    for (const [type, stateId, subId, model, battery] of rows) {
        const on = deviceConnected(type);
        const state = document.getElementById(stateId);
        if (!state) continue;
        setText(stateId, on ? 'Connected' : 'Not connected');
        state.classList.toggle('is-on', on);
        setText(subId, on && battery != null ? `${model} · battery ${battery} %` : model);
    }
}

function renderDeviceIcon(id, name, connected) {
    const el = document.getElementById(id);
    if (!el) return;
    const was = el.dataset.connected === 'true';
    el.dataset.connected = String(connected);
    if (connected && !was) {
        el.setAttribute('aria-label', `${name} connected`);
        el.title = `${name} connected`; // battery % is added when readings arrive
    } else if (!connected) {
        el.setAttribute('aria-label', `${name}: not connected. Tap to connect`);
        el.title = `${name} not connected`;
    }
}

let connectingFromScreen = false;
/** Tap on a faded header icon: connect whatever is missing (one picker). */
async function connectFromIcon(type) {
    if (deviceConnected(type) || connectingFromScreen) return;
    connectingFromScreen = true;
    try { await connectDevices(); } finally { connectingFromScreen = false; }
}

/** The Connect buttons in the empty chart and under a stopped brew's chart. */
async function connectFromChart(id = 'chartConnectBtn') {
    const btn = document.getElementById(id);
    if (connectingFromScreen) return;
    connectingFromScreen = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    try { await connectDevices(); } finally {
        connectingFromScreen = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
        renderConnectionState();
    }
}

// Backwards-compatible wrapper (older code/tests call updateStatus).
function updateStatus(status, connected = false) {
    renderConnectionState(connected ? undefined : status !== 'Disconnected' ? status : undefined);
}

// --- Elapsed time: the scale's timer when it is connected and driven, otherwise the app's own clock ---
const appTimer = {
    startedAt: null,
    elapsedMs: 0,
    interval: null,
    now: () => performance.now(),
    elapsed() { return this.elapsedMs + (this.startedAt != null ? this.now() - this.startedAt : 0); },
    start() {
        this.elapsedMs = 0;
        this.startedAt = this.now();
        clearInterval(this.interval);
        this.interval = setInterval(() => {
            if (!scaleIsTimeSource()) renderElapsed(this.elapsed());
            refreshChart(); // keeps the time axis moving between readings
        }, 200);
    },
    stop() {
        if (this.startedAt != null) this.elapsedMs += this.now() - this.startedAt;
        this.startedAt = null;
        clearInterval(this.interval);
        this.interval = null;
    },
    reset() { this.stop(); this.elapsedMs = 0; },
};

function timerDrives(type) {
    const el = document.getElementById(type === 'scale' ? 'driveScaleTimer' : 'drivePortalTimer');
    return el ? el.checked : true;
}

function scaleIsTimeSource() {
    return deviceConnected('scale') && timerDrives('scale');
}

function renderElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    document.getElementById('timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateDisplay(scaleData) {
    lastScaleData = scaleData;
    setWeightNumber(scaleData.weight);
    renderWeightReadout(true);
    document.getElementById('flowRate').textContent = `${scaleData.flowRate.toFixed(1)} g/s`;
    const showRemainder = document.getElementById('showRemainder');
    const remainderPanel = document.getElementById('remainderPanel');
    // Remaining to the target: always on a tablet, otherwise only with "Show Remainder"
    if (targetWeight !== null) {
        const remainder = targetWeight - scaleData.weight;
        document.getElementById('remainder').textContent = `${remainder.toFixed(1)} g`;
    }
    if (isTablet() || (targetWeight !== null && showRemainder && showRemainder.checked)) {
        if (remainderPanel) remainderPanel.style.display = '';
    } else if (remainderPanel) {
        remainderPanel.style.display = 'none';
    }
    // Calculated ratio (next to the timer)
    const calculatedRatioDisplay = document.getElementById('calculatedRatioDisplay');
    let beanWeight = memory.beans?.weight || null;
    let ratioStr = '';
    if (beanWeight && beanWeight > 0) {
        const calcRatio = scaleData.weight / beanWeight;
        if (isFinite(calcRatio) && calcRatio > 0) {
            ratioStr = `1:${calcRatio.toFixed(1)}`;
        }
    }
    if (calculatedRatioDisplay) calculatedRatioDisplay.textContent = ratioStr;
    // Current Ratio panel logic (unchanged)
    const showCurrentRatio = document.getElementById('showCurrentRatio');
    const currentRatioPanel = document.getElementById('currentRatioPanel');
    const currentRatioValue = document.getElementById('currentRatio');
    if (showCurrentRatio && currentRatioPanel && currentRatioValue) {
        if (showCurrentRatio.checked && targetWeight && memory.beans?.weight && !isTablet()) { // the tablet has the ratio in the hero
            const currentRatio = scaleData.weight / memory.beans.weight;
            if (isFinite(currentRatio) && currentRatio > 0) {
                currentRatioValue.textContent = `1:${currentRatio.toFixed(1)}`;
            } else {
                currentRatioValue.textContent = '';
            }
            currentRatioPanel.style.display = '';
        } else {
            currentRatioValue.textContent = '';
            currentRatioPanel.style.display = 'none';
        }
    }
    // Elapsed time
    renderElapsed(scaleIsTimeSource() ? scaleData.milliseconds : appTimer.elapsed());
    const scaleIcon = document.getElementById('scaleIcon');
    if (scaleIcon && scaleData.batteryPercent != null) scaleIcon.title = `Scale connected · battery ${scaleData.batteryPercent}%`;
    renderDeviceRows();
}

/** EC meter (Belka Portal) readings: temperature and EC cards. */
function updatePortalDisplay(portalData) {
    const tempEl = document.getElementById('tempValue');
    if (tempEl) tempEl.textContent = `${portalData.temp.toFixed(1)} °C`;
    const ecEl = document.getElementById('ecValue');
    if (ecEl) ecEl.textContent = `${portalData.ec.toFixed(2)} mS/cm`;
    const portalIcon = document.getElementById('portalIcon');
    if (portalIcon) portalIcon.title = `EC meter connected · battery ${portalData.battery}%`;
    renderDeviceRows();
}

function onScaleData(scaleData) {
    if (recorder.running) ciy.addWeight(scaleData.weight);
    lastScaleData = scaleData;
    syncRecorderTds();
    recorder.addScale(scaleData);
    if (finalSnapshot) renderLiveStrip();
    else updateDisplay(scaleData);
    renderTdsPanel();
    renderFinalTdsDialog();
    refreshChart();
    log(`Weight: ${scaleData.weight.toFixed(2)}g, Flow: ${scaleData.flowRate.toFixed(2)}g/s, Battery: ${scaleData.batteryPercent}%`);
}

function onPortalData(portalData) {
    lastPortalData = portalData;
    // Each EC reading adds EC x the water poured since the last one
    if (recorder.running && deviceConnected('scale') && lastScaleData) {
        ciy.addEc(portalData.ec); // already temperature-compensated by the device
        tdsBrew = tdsBrew || ciy.steps > 0;
    }
    syncRecorderTds();
    recorder.addPortal(portalData);
    if (finalSnapshot) renderLiveStrip();
    else updatePortalDisplay(portalData);
    renderTdsPanel();
    if (!finalSnapshot) {
        recordExtractionTrail();
        renderExtractionChart();
    }
    refreshChart();
}

// --- Stopped view: final values frozen in the main readouts, live readings in a strip ---
function captureFinal() {
    const ms = scaleIsTimeSource() && lastScaleData ? lastScaleData.milliseconds : appTimer.elapsed();
    const weight = lastScaleData ? lastScaleData.weight : null;
    const ecs = recorder.rows.filter((r) => r.source === 'portal' && r.ec != null).map((r) => r.ec);
    finalSnapshot = {
        ms,
        weight,
        avgFlow: weight != null && ms > 0 ? weight / (ms / 1000) : null,
        peakEc: ecs.length ? Math.max(...ecs) : null,
        // Only if the EC meter took part in this brew
        temp: ecs.length && lastPortalData ? lastPortalData.temp : null,
        // Only if the scale and the EC meter were both used (TDS)
        ciy: tdsBrew ? ciy.ciy : null,
        estYield: tdsBrew ? estimatedYield() : null,
        estTds: tdsBrew ? liveTds() : null,
    };
    if (tdsBrew) saveLastBrew({ ciy: ciy.ciy, estYield: finalSnapshot.estYield, yield: null, at: Date.now() });
    fullSnapshot = null;
    saveBrewToLog();
    renderFinal();
    renderTrimButton();
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

/**
 * Write the weight as whole grams + ".tenth" in separate spans, so CSS can keep
 * the decimal point at the horizontal centre. textContent stays e.g. "240.6".
 */
function setWeightNumber(weight) {
    const el = document.getElementById('weightDisplay');
    if (!el) return;
    const [whole, tenth] = weight.toFixed(1).split('.');
    const intEl = el.querySelector('.w-int');
    const fracEl = el.querySelector('.w-frac');
    if (intEl && fracEl) {
        if (intEl.textContent !== whole) intEl.textContent = whole;
        if (fracEl.textContent !== `.${tenth}`) fracEl.textContent = `.${tenth}`;
        return;
    }
    el.innerHTML = `<span class="w-int">${whole}</span><span class="w-frac">.${tenth}</span>`;
}

/**
 * Label and unit around the big weight number:
 * - no weight yet / scale gone: "grams" placeholder label, "--", no unit
 * - live weight: no label, number + "g"
 * - after Stop: "Final" label, final number + "g"
 * `shown` is true when the caller just put a weight in the number.
 */
function renderWeightReadout(shown = false) {
    const label = document.getElementById('weightUnitLabel');
    const unit = document.getElementById('weightUnit');
    const value = document.getElementById('weightDisplay');
    if (!label || !unit || !value) return;
    const final = finalSnapshot && finalSnapshot.weight != null;
    const hasWeight = final || shown || lastScaleData != null;
    if (!hasWeight && value.textContent !== '--') value.textContent = '--';
    label.textContent = final ? 'Final' : 'grams';
    // Live weight: keep the label's space so the number doesn't move vertically
    label.style.visibility = hasWeight && !final ? 'hidden' : '';
    unit.hidden = !hasWeight;
    value.classList.toggle('is-placeholder', !hasWeight);
}

function renderFinal() {
    const f = finalSnapshot;
    if (!f) return;
    if (f.weight != null) {
        // updateDisplay remembers what it shows as the latest reading; keep the live one
        const live = lastScaleData;
        updateDisplay({ ...(live || {}), weight: f.weight, flowRate: 0, milliseconds: f.ms });
        lastScaleData = live;
    }
    renderElapsed(f.ms);
    renderWeightReadout();
    setText('flowRateLabel', 'Avg flow');
    setText('flowRate', f.avgFlow != null ? `${f.avgFlow.toFixed(1)} g/s` : '-- g/s');
    setText('tempLabel', 'Temp at stop');
    setText('tempValue', f.temp != null ? `${f.temp.toFixed(1)} °C` : '-- °C');
    if (f.ciy != null && !isTablet()) {
        // TDS brew: CIY replaces the EC card (the tablet has a CIY reading of its own)
        setText('ecLabel', 'CIY');
        setText('ecValue', formatCiy(f.ciy));
    } else {
        setText('ecLabel', 'Peak EC');
        setText('ecValue', f.peakEc != null ? `${f.peakEc.toFixed(2)} mS/cm` : '-- mS/cm');
    }
    renderTdsPanel();
    renderYieldPanel();
    renderBeanButton();
    renderExtractionChart();
    renderLiveStrip();
}

function clearFinal() {
    if (trimMode) endTrimMode();
    finalSnapshot = null;
    fullSnapshot = null;
    finalTds = null;
    renderTrimButton();
    closeFinalTds();
    setText('flowRateLabel', 'Flow');
    setText('tempLabel', 'Temp');
    setText('ecLabel', 'EC');
    if (lastScaleData && deviceConnected('scale')) updateDisplay(lastScaleData);
    else {
        setText('flowRate', '0.0 g/s');
    }
    renderWeightReadout();
    if (lastPortalData && deviceConnected('portal')) updatePortalDisplay(lastPortalData);
    else resetPortalDisplay();
    renderTdsPanel();
    renderYieldPanel();
    renderBeanButton();
    extractionLabelsShown = false;
    showChartSlide(0, false);
    renderExtractionChart();
    renderLiveStrip();
}

function renderLiveStrip() {
    const strip = document.getElementById('liveStrip');
    if (!strip) return;
    if (trimMode) { strip.hidden = true; return; } // the trim hint takes its place
    const parts = [];
    if (finalSnapshot) {
        if (deviceConnected('scale') && lastScaleData) parts.push(`${lastScaleData.weight.toFixed(1)} g`);
        if (deviceConnected('portal') && lastPortalData) parts.push(`${lastPortalData.temp.toFixed(1)} °C`, `${lastPortalData.ec.toFixed(2)} mS/cm`);
    }
    strip.hidden = !parts.length;
    const text = parts.length ? `Live  ${parts.join(' · ')}` : '';
    if (strip.textContent !== text) strip.textContent = text;
}

function handleWeightData(event) {
    // Raw packet logging only; parsing happens in ScaleController ('data' event).
    let data;
    if (event instanceof Uint8Array) {
        data = event;
    } else if (event && event.buffer && event.byteLength) {
        data = new Uint8Array(event);
    } else if (event && event.target && event.target.value && event.target.value.buffer) {
        data = new Uint8Array(event.target.value.buffer);
    } else {
        return; // unknown format
    }
    log(`Received data: ${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
}

// Subscribe once to both devices.
devices.scale.addEventListener('data', onScaleData);
devices.scale.addEventListener('raw', handleWeightData);
devices.portal.addEventListener('data', onPortalData);
devices.addEventListener('change', ({ type, connected }) => {
    log(`${type === 'scale' ? 'Scale' : 'EC meter'} ${connected ? 'connected' : 'disconnected'}`);
    if (!connected) {
        recorder.clearSource(type);
        if (type === 'scale') onScaleDisconnected();
        if (type === 'portal') resetPortalDisplay();
    }
    renderConnectionState();
});

function resetPortalDisplay() {
    // After Stop the cards hold the brew's final values (temp at stop, CIY / peak EC): keep them
    if (finalSnapshot) { renderFinal(); return; }
    const tempEl = document.getElementById('tempValue');
    if (tempEl) tempEl.textContent = '-- °C';
    const ecEl = document.getElementById('ecValue');
    if (ecEl) ecEl.textContent = '-- mS/cm';
}

/** Connect whichever devices are missing (must run from a click). */
async function connectDevices() {
    try {
        log('Requesting Bluetooth device(s)...');
        const { connected, failed } = await devices.connectMissing();
        for (const t of connected) log(`Connected: ${devices.names[t]}`);
        for (const f of failed) log(`Connection error (${f.type}): ${f.error?.message}`);
        renderConnectionState(failed.length && !devices.anyConnected() ? `Error: ${failed[0].error?.message}` : undefined);
    } catch (error) {
        log(`Connection error: ${error.message}`);
        renderConnectionState(`Error: ${error.message}`);
    }
}

// Kept for existing callers/tests
const connectToScale = connectDevices;

async function sendTareCommand() {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) {
        log('Not connected to scale');
        return;
    }
    try {
        await sc.tare();
        log('Tare command sent');
    } catch (error) {
        log(`Error sending tare command: ${error.message}`);
    }
}


async function sendTareAndStartCommand() {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) {
        log('Not connected to scale');
        return;
    }
    try {
        await sc.tareAndStart();
        log('Tare and start timer command sent');
        await startBrew({ scaleAlreadyStarted: true });
    } catch (error) {
        log(`Error sending tare and start command: ${error.message}`);
    }
}

// --- Screen Wake Lock API integration ---
let wakeLock = null;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                log('Screen Wake Lock released');
            });
            log('Screen Wake Lock acquired');
        }
    } catch (err) {
        log('Wake Lock error: ' + err.message);
    }
}

async function releaseWakeLock() {
    if (wakeLock) {
        try {
            await wakeLock.release();
            wakeLock = null;
        } catch (err) {
            log('Wake Lock release error: ' + err.message);
        }
    }
}

// --- Brew timer: drives the connected devices selected in Settings ---
function timerTargets() {
    return ['scale', 'portal'].filter((t) => deviceConnected(t) && timerDrives(t));
}

async function sendToDevices(action, types) {
    const label = { start: 'Start', stop: 'Stop', reset: 'Reset' }[action];
    await Promise.all(types.map(async (t) => {
        try {
            if (t === 'scale') {
                const sc = devices.scale;
                if (action === 'start') await sc.startTimer();
                else if (action === 'stop') await sc.stopTimer();
                else await sc.resetTimer();
            } else if (action !== 'reset') {
                // The EC meter has no reset; its timer restarts on the next start.
                if (action === 'start') await devices.portal.startTimer();
                else await devices.portal.stopTimer();
            }
            log(`${label} timer command sent (${t === 'scale' ? 'scale' : 'EC meter'})`);
        } catch (error) {
            log(`Error sending ${label.toLowerCase()} to ${t}: ${error.message}`);
        }
    }));
}

async function startBrew({ scaleAlreadyStarted = false } = {}) {
    const targets = timerTargets().filter((t) => !(scaleAlreadyStarted && t === 'scale'));
    if (finalSnapshot) clearFinal();
    // Tare and start zeroes the scale, so the brew starts from 0 g
    ciy.reset(scaleAlreadyStarted ? 0 : lastScaleData?.weight ?? null);
    tdsBrew = false;
    extractionTrail = [];
    recorder.setDerived();
    appTimer.start();
    recorder.start();
    chartCleared = false;
    refreshChart();
    timerState = 'running';
    renderTimerIcon();
    updateExportButton();
    renderExtractionChart(); // the live path slide (stays on the brew chart)
    requestWakeLock();
    await sendToDevices('start', targets);
}

async function stopBrew() {
    appTimer.stop();
    recorder.stop();
    refreshChart();
    timerState = 'reset-required';
    captureFinal();
    renderBeanButton();
    renderTimerIcon();
    updateExportButton();
    releaseWakeLock();
    await sendToDevices('stop', timerTargets());
}

async function resetBrew() {
    appTimer.reset();
    chartCleared = true;
    refreshChart();
    timerState = 'stopped';
    clearFinal();
    renderTimerIcon();
    renderElapsed(0);
    renderConnectionState(); // e.g. nothing connected: Start greyed out, Connect back in the empty chart
    await sendToDevices('reset', timerTargets());
}

async function triStateTimer() {
    if (!isConnected && timerState !== 'reset-required') {
        log('Not connected');
        return;
    }
    try {
        if (timerState === 'stopped') await startBrew();
        else if (timerState === 'running') await stopBrew();
        else if (timerState === 'reset-required') await resetBrew();
    } catch (error) {
        log(`Error in timer button: ${error.message}`);
    }
}

// --- Brew CSV export ---
function updateExportButton() {
    const btn = document.getElementById('exportCsvBtn');
    if (btn) btn.hidden = recorder.running || !recorder.hasData();
}

function exportBrewCsv() {
    if (!recorder.hasData()) return;
    const blob = new Blob([recorder.toCSV()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = recorder.fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log(`Exported ${recorder.rows.length} samples`);
}

// --- Timer settings (persisted) ---
const TIMER_DRIVES_KEY = 'timerDrivesV1';
function loadTimerDrives() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(TIMER_DRIVES_KEY)) || {}; } catch {}
    for (const [id, key] of [['driveScaleTimer', 'scale'], ['drivePortalTimer', 'portal']]) {
        const el = document.getElementById(id);
        if (el && typeof saved[key] === 'boolean') el.checked = saved[key];
    }
}
window.addEventListener('DOMContentLoaded', () => {
    loadTimerDrives();
    for (const id of ['driveScaleTimer', 'drivePortalTimer']) {
        document.getElementById(id)?.addEventListener('change', () => {
            const value = { scale: timerDrives('scale'), portal: timerDrives('portal') };
            try { localStorage.setItem(TIMER_DRIVES_KEY, JSON.stringify(value)); } catch {}
            sync?.schedule();
        });
    }
    renderConnectionState();
    renderWeightReadout();
});

async function sendStartTimerCommand() {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) { log('Not connected to scale'); return; }
    try {
        await sc.startTimer();
        log('Start timer command sent');
    } catch (error) {
        log(`Error sending start timer command: ${error.message}`);
    }
}

async function sendStopTimerCommand() {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) { log('Not connected to scale'); return; }
    try {
        await sc.stopTimer();
        log('Stop timer command sent');
    } catch (error) {
        log(`Error sending stop timer command: ${error.message}`);
    }
}

async function sendResetTimerCommand() {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) { log('Not connected to scale'); return; }
    try {
        await sc.resetTimer();
        log('Reset timer command sent');
        timerLocked = false;
        timerRunning = false;
        const toggleBtn = document.getElementById('timerToggleBtn');
        if (toggleBtn) toggleBtn.textContent = 'Start Timer';
    } catch (error) {
        log(`Error sending reset timer command: ${error.message}`);
    }
}

async function setBeepLevel(level) {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) { log('Not connected to scale'); return; }
    try {
        await sc.setBeep(level);
        const beepValueEl = document.getElementById('beepValue');
        if (beepValueEl) beepValueEl.textContent = level;
        log(`Beep level set to ${level}`);
    } catch (error) {
        log(`Error setting beep level: ${error.message}`);
    }
}

async function setAutoOff(minutes) {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) { log('Not connected to scale'); return; }
    try {
        await sc.setAutoOff(minutes);
        const el = document.getElementById('autoOffValue');
        if (el) el.textContent = minutes;
        log(`Auto-off set to ${minutes} minutes`);
    } catch (error) {
        log(`Error setting auto-off: ${error.message}`);
    }
}

async function setFlowSmoothing(enabled) {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) { log('Not connected to scale'); return; }
    try {
        await sc.setFlowSmoothing(enabled);
        log(`Flow smoothing ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
        log(`Error setting flow smoothing: ${error.message}`);
    }
}

// --- Ratio presets and Ratio Slider Overlay ---

// Ratio presets
const brewRatios = [
    { ratio: 12, label: 'Very Strong' },
    { ratio: 13, label: 'Strong' },
    { ratio: 14, label: 'Bold' },
    { ratio: 15, label: 'Medium' },
    { ratio: 16, label: 'Balanced' },
    { ratio: 17, label: 'Light' },
    { ratio: 18, label: 'Very Light' }
];
const espressoRatios = [
    { ratio: 1, label: 'Ristretto' },
    { ratio: 1.5, label: 'Short' },
    { ratio: 2, label: 'Normal' },
    { ratio: 2.5, label: 'Long' }
];
let currentBrewMode = 'brew'; // or 'espresso'
// Brew ratio (1:N) from Settings; target weight = stored bean dose x N
const RATIO_KEY = 'brewRatioV1';
const DEFAULT_RATIO = 15;
const MAX_RATIO = 30;
let currentRatio = loadRatio();

function loadRatio() {
    try {
        const r = parseFloat(localStorage.getItem(RATIO_KEY));
        if (r > 0 && r <= MAX_RATIO) return r;
    } catch {}
    return DEFAULT_RATIO;
}

/** "15" or "15.5" (no trailing zeros) */
function formatRatioNumber(r) {
    return String(Math.round(r * 100) / 100);
}

/** Target weight always = stored bean dose x ratio from Settings. */
function recomputeTarget() {
    const dose = memory.beans?.weight;
    targetWeight = dose > 0 ? dose * currentRatio : null;
    // Target card: "20g(in) → 300g(out)" with in/out as subscripts
    const twEl = document.getElementById('targetWeight');
    if (twEl) {
        const g = (v) => String(Number(v.toFixed(1))); // 20, 18.5, 277.5
        if (targetWeight != null) {
            twEl.textContent = `${g(dose)} → ${g(targetWeight)} g`;
            twEl.setAttribute('aria-label', `${g(dose)} grams in, ${g(targetWeight)} grams out`);
        } else {
            twEl.textContent = '-- g';
            twEl.removeAttribute('aria-label');
        }
        fitTarget(twEl);
    }
    // Refresh remainder / current-ratio panels and the chart's target line
    if (lastScaleData && !finalSnapshot) updateDisplay(lastScaleData);
    refreshChart();
}

/** Shrink a one-line value until it fits its card (down to 11px). */
function fitText(el) {
    el.style.fontSize = '';
    if (!el.clientWidth) return; // hidden
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 11) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
    }
}

/** Three or more cards in the row: plain "20g → 300g" (no in/out subscripts), then fit. */
function fitTarget(el) {
    const cards = [...el.parentElement.parentElement.children].filter((c) => getComputedStyle(c).display !== 'none').length;
    el.classList.toggle('compact', cards >= 3);
    fitText(el);
}

window.addEventListener('DOMContentLoaded', () => {
    // Re-fit when the card changes width (e.g. the Yield card appears next to it)
    const twEl = document.getElementById('targetWeight');
    if (twEl && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitTarget(twEl)).observe(twEl.parentElement);
});

function setRatio(r) {
    currentRatio = r;
    try { localStorage.setItem(RATIO_KEY, String(r)); } catch {}
    renderRatioSetting();
    recomputeTarget();
    sync?.schedule();
}

// --- Settings: ratio row (Edit turns the number into an input) ---
function renderRatioSetting() {
    const display = document.getElementById('ratioSettingValue');
    if (display) display.textContent = formatRatioNumber(currentRatio);
}

function startRatioEdit() {
    const cell = document.getElementById('ratioSettingCell');
    const btn = document.getElementById('ratioEditBtn');
    if (!cell || !btn || document.getElementById('ratioInput')) return;
    cell.innerHTML = `1:<input type="number" id="ratioInput" min="0" max="${MAX_RATIO}" step="any" inputmode="decimal" aria-label="Ratio, water per gram of beans" value="${formatRatioNumber(currentRatio)}">`;
    btn.textContent = 'Save';
    btn.onclick = saveRatioEdit;
    const input = document.getElementById('ratioInput');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveRatioEdit(); }
        if (e.key === 'Escape') { e.stopPropagation(); endRatioEdit(); }
    });
    input.addEventListener('input', () => showRatioError(''));
    input.focus();
    input.select();
}

function saveRatioEdit() {
    const input = document.getElementById('ratioInput');
    if (!input) return;
    const r = parseFloat(input.value);
    if (!(r > 0 && r <= MAX_RATIO)) {
        showRatioError(`Enter a number above 0 and up to ${MAX_RATIO}.`);
        input.focus();
        return;
    }
    setRatio(r);
    endRatioEdit();
    log(`Ratio set to 1:${formatRatioNumber(r)}`);
}

function endRatioEdit() {
    const cell = document.getElementById('ratioSettingCell');
    const btn = document.getElementById('ratioEditBtn');
    if (cell) cell.innerHTML = '1:<span id="ratioSettingValue"></span>';
    if (btn) { btn.textContent = 'Edit'; btn.onclick = startRatioEdit; }
    showRatioError('');
    renderRatioSetting();
}

function showRatioError(msg) {
    const el = document.getElementById('ratioError');
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
}

window.addEventListener('DOMContentLoaded', () => {
    endRatioEdit();
    recomputeTarget();
});

// --- Ratio Slider Overlay Logic ---
// --- Ritual2-style Ratio Slider Overlay Logic ---
let ratioSliderState = {
    isDragging: false,
    startY: 0,
    startOffset: 0,
    offset: 0,
    selectedIdx: 0
};

function renderRatioSlider() {
    const track = document.getElementById('ratioSliderTrack');
    if (!track) return;
    const ratios = currentBrewMode === 'brew' ? brewRatios : espressoRatios;
    track.innerHTML = '';
    ratios.forEach((r, i) => {
        const option = document.createElement('div');
        option.className = 'ratio-slider-option' + (i === ratioSliderState.selectedIdx ? ' selected' : '');
        option.setAttribute('tabindex', '0');
        option.setAttribute('role', 'option');
        option.setAttribute('aria-label', `${r.ratio}:1 ${r.label}`);
        option.innerHTML = `<div style="font-size:2rem;">${r.ratio}:1</div><div style="font-size:0.95rem; color:#b77b2b; opacity:0.7;">${r.label}</div>`;
        option.onmousedown = (e) => { ratioSliderStartDrag(e, i); };
        option.ontouchstart = (e) => { ratioSliderStartDrag(e, i); };
        option.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                selectRatioIdx(i);
            }
        };
        track.appendChild(option);
    });
    // Position track
    track.style.transform = `translateY(${160 - ratioSliderState.selectedIdx * 70 + ratioSliderState.offset}px)`;
}

function openRatioSlider() {
    const overlay = document.getElementById('ratioSliderOverlay');
    if (!overlay) return;
    const ratios = currentBrewMode === 'brew' ? brewRatios : espressoRatios;
    // Set selectedIdx to currentRatio
    let idx = ratios.findIndex(r => r.ratio === currentRatio);
    if (idx < 0) idx = 0;
    ratioSliderState.selectedIdx = idx;
    ratioSliderState.offset = 0;
    renderRatioSlider();
    overlay.style.display = '';
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

// (Removed duplicate closeRatioSlider definition)

function selectRatioIdx(idx) {
    const ratios = currentBrewMode === 'brew' ? brewRatios : espressoRatios;
    ratioSliderState.selectedIdx = idx;
    currentRatio = ratios[idx].ratio;
    document.getElementById('ratioLabel').textContent = `${currentRatio}:1`;
    renderRatioSlider();
}

function ratioSliderStartDrag(e, idx) {
    e.preventDefault();
    ratioSliderState.isDragging = true;
    ratioSliderState.startY = e.touches ? e.touches[0].clientY : e.clientY;
    ratioSliderState.startOffset = ratioSliderState.offset;
    document.addEventListener('mousemove', ratioSliderDragMove);
    document.addEventListener('mouseup', ratioSliderDragEnd);
    document.addEventListener('touchmove', ratioSliderDragMove, {passive:false});
    document.addEventListener('touchend', ratioSliderDragEnd);
}

function ratioSliderDragMove(e) {
    if (!ratioSliderState.isDragging) return;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    let delta = clientY - ratioSliderState.startY;
    ratioSliderState.offset = ratioSliderState.startOffset + delta;
    // Clamp offset
    const ratios = currentBrewMode === 'brew' ? brewRatios : espressoRatios;
    const minOffset = -((ratios.length-1) * 70);
    const maxOffset = 0;
    if (ratioSliderState.offset < minOffset) ratioSliderState.offset = minOffset;
    if (ratioSliderState.offset > maxOffset) ratioSliderState.offset = maxOffset;
    // Snap to nearest
    const idx = Math.round(-ratioSliderState.offset / 70);
    if (idx !== ratioSliderState.selectedIdx && idx >= 0 && idx < ratios.length) {
        selectRatioIdx(idx);
    } else {
        renderRatioSlider();
    }
}

function ratioSliderDragEnd(e) {
    ratioSliderState.isDragging = false;
    document.removeEventListener('mousemove', ratioSliderDragMove);
    document.removeEventListener('mouseup', ratioSliderDragEnd);
    document.removeEventListener('touchmove', ratioSliderDragMove);
    document.removeEventListener('touchend', ratioSliderDragEnd);
    // Snap to selected
    ratioSliderState.offset = -ratioSliderState.selectedIdx * 70;
    renderRatioSlider();
}
function closeRatioSlider() {
    const overlay = document.getElementById('ratioSliderOverlay');
    if (overlay) overlay.style.display = 'none';
}
function switchBrewMode(mode) {
    currentBrewMode = mode;
    openRatioSlider();
}

window.addEventListener('DOMContentLoaded', () => {
    // Ratio slider button
    const ratioBtn = document.getElementById('openRatioSliderBtn');
    if (ratioBtn) {
        ratioBtn.addEventListener('click', openRatioSlider);
    }
    // Overlay close
    const closeBtn = document.getElementById('closeRatioSliderBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeRatioSlider);
    // Set initial ratio label
    const ratioLabel = document.getElementById('ratioLabel');
    if (ratioLabel) ratioLabel.textContent = `${currentRatio}:1`;
    // Render ratio slider if overlay is open (for hot reload/dev)
    if (document.getElementById('ratioSliderOverlay').style.display !== 'none') {
        renderRatioSlider();
    }
});

// Patch tareBean to use currentRatio
async function tareBean() {
    const sc = window.__scaleController;
    if (!sc || !sc.isConnected()) { log('Not connected to scale'); return; }
    try {
        // Use the displayed weight as the current weight
        const weightDisplay = document.getElementById('weightDisplay');
        const currentWeight = weightDisplay ? parseFloat(weightDisplay.textContent) : 0;
        // Store the bean dose; the target weight (dose x ratio) is recomputed from it
        if (!isNaN(currentWeight)) {
            memory.beans = { weight: currentWeight };
            saveMemory();
        }
        await sc.tare();
        log(`Set Beans: ${currentWeight.toFixed(2)}g × ${currentRatio} = ${targetWeight != null ? targetWeight.toFixed(1) : '--'}g (scale tared)`);
    } catch (error) {
        log(`Error in Tare Bean: ${error.message}`);
    }
}

// Keyboard accessibility for overlay
window.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('ratioSliderOverlay');
    if (overlay && overlay.style.display !== 'none') {
        if (e.key === 'Escape') closeRatioSlider();
        // Up/down arrow navigation
        const ratios = currentBrewMode === 'brew' ? brewRatios : espressoRatios;
        if (e.key === 'ArrowUp') {
            if (ratioSliderState.selectedIdx > 0) {
                selectRatioIdx(ratioSliderState.selectedIdx - 1);
                e.preventDefault();
            }
        } else if (e.key === 'ArrowDown') {
            if (ratioSliderState.selectedIdx < ratios.length - 1) {
                selectRatioIdx(ratioSliderState.selectedIdx + 1);
                e.preventDefault();
            }
        }
    }
});

// --- TDS: live estimate, final TDS calculator, bed absorption and k_v calibration ---
const KV_KEY = 'tdsKvV1';
const KV_HISTORY_KEY = 'kvHistoryV1';
const LAST_BREW_KEY = 'lastBrewV1';
const ABSORPTION_KEY = 'bedAbsorptionV1';
const MIN_CAL_TDS = 0.1;
const MAX_CAL_TDS = 25;

function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    if (SYNCED_SETTINGS.includes(key)) sync?.schedule();
}

// Calibrated k_v (null until the first calibration; DEFAULT_KV is used meanwhile)
function loadKv() { const v = loadJson(KV_KEY); return typeof v === 'number' && v > 0 ? v : null; }
function loadAbsorption() { const v = loadJson(ABSORPTION_KEY); return typeof v === 'number' && v >= 0 && v <= MAX_ABSORPTION ? v : DEFAULT_ABSORPTION; }
let kv = loadKv();
function activeKv() { return kv ?? DEFAULT_KV; }
let absorption = loadAbsorption();

/** 4 significant digits, no trailing zeros ("0.005", "0.005086") */
/** "Oct 20, 09:56 a.m." (date, comma, time), used wherever a brew's time is shown */
function formatShortDateTime(at) {
    const d = new Date(at);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
function formatKv(v) { return v > 0 ? String(Number(v.toPrecision(4))) : '--'; }
function formatCiy(v) { return v != null ? v.toFixed(1) : '--'; }
/** "2.0", "2.15" (at least one decimal) */
function formatAbsorption(a) {
    const s = String(Math.round(a * 100) / 100);
    return s.includes('.') ? s : `${s}.0`;
}
function formatTds(v) { return v != null ? `${v.toFixed(2)} %` : '-- %'; }
function byId(id) { return document.getElementById(id); }

/** Water poured minus what the bed holds (bean dose x absorption). */
function estimatedYield() {
    return liveYield(ciy.poured, memory.beans?.weight, absorption);
}

/** TDS % estimated from the live yield; null until it can be computed. */
function liveTds() {
    return tdsBrew ? tdsPercent(activeKv(), ciy.ciy, estimatedYield()) : null;
}

/** CIY and TDS go into the CSV rows next to the raw readings. */
function syncRecorderTds() {
    recorder.setDerived({
        ciy: tdsBrew ? ciy.ciy : null,
        tds: tdsBrew ? liveTds() : null,
    });
}

/** TDS card: live estimate while brewing with both devices, final values after Stop. */
function renderTdsPanel() {
    renderTabletReadings();
    const panel = byId('tdsPanel');
    if (!panel) return;
    const both = deviceConnected('scale') && deviceConnected('portal');
    const show = finalSnapshot ? finalSnapshot.ciy != null : both;
    panel.hidden = !show && !isTablet();
    // Marked until k_v has been calibrated (the default is used meanwhile)
    setText('tdsLabel', `${finalTds ? 'TDS' : 'TDS ≈'}${kv ? '' : ' (uncal.)'}`);
    let text;
    if (!show) text = '-- %';
    else if (finalTds) text = formatTds(finalTds.tds);
    else if (finalSnapshot) text = formatTds(finalSnapshot.estTds);
    else if (!recorder.running || recorder.elapsed() < tdsMinSeconds) text = '-- %';
    else text = formatTds(liveTds());
    setText('tdsValue', text);
}

/** Tablet only: Extraction, CIY and the live yield have readings of their own. */
function renderTabletReadings() {
    const tablet = isTablet();
    for (const id of ['eyPanel', 'ciyPanel']) {
        const el = byId(id);
        if (el) el.hidden = !tablet;
    }
    // Remaining: always on a tablet; on a phone only with the (hidden) "Show Remainder" setting
    const remainderPanel = byId('remainderPanel');
    if (remainderPanel && (tablet || !byId('showRemainder')?.checked)) remainderPanel.style.display = tablet ? '' : 'none';
    if (!tablet) return;
    const point = extractionPoint();
    setText('eyLabel', point?.final ? 'Extraction' : 'Extraction ≈');
    setText('eyValue', point ? `${point.ey.toFixed(1)} %` : '-- %');
    setText('ciyValue', formatCiy(finalSnapshot ? finalSnapshot.ciy : recorder.running && tdsBrew ? ciy.ciy : null));
    renderYieldPanel();
}

function renderYieldPanel() {
    const panel = byId('yieldPanel');
    if (!panel) return;
    panel.hidden = !finalTds && !isTablet();
    if (finalTds) {
        setText('yieldLabel', 'Yield');
        setText('yieldValue', `${finalTds.yieldG.toFixed(1)} g`);
    } else if (isTablet()) {
        // Tablet: the estimate (water poured minus what the bed holds) until the calculator
        const est = finalSnapshot ? finalSnapshot.estYield : recorder.running ? estimatedYield() : null;
        setText('yieldLabel', 'Yield ≈');
        setText('yieldValue', est != null ? `${est.toFixed(1)} g` : '-- g');
    }
    // The target card's format depends on how many cards share its row; apply it now, not on the next resize
    const twEl = byId('targetWeight');
    if (twEl) fitTarget(twEl);
}

// --- Bean button: "set beans", or the final TDS calculator after a TDS brew is stopped ---
const CALC_ICON = `<span class="side-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg></span><span class="side-label">Final TDS</span>`;
let beanButtonHtml = null;

function calculatorMode() {
    return timerState === 'reset-required' && finalSnapshot?.ciy != null;
}

function renderBeanButton() {
    const btn = byId('tareBeanBtn');
    if (!btn) return;
    if (beanButtonHtml == null) beanButtonHtml = btn.innerHTML;
    const calc = calculatorMode();
    const mode = calc ? 'calc' : 'bean';
    if (btn.dataset.mode !== mode) {
        btn.dataset.mode = mode;
        btn.innerHTML = calc ? CALC_ICON : beanButtonHtml;
        btn.setAttribute('aria-label', calc ? 'Final TDS calculator' : 'Set beans');
        btn.title = calc ? 'Final TDS: weigh the coffee to calculate its TDS' : 'Set beans: stores the bean (B) weight in memory (M)';
    }
    btn.disabled = calc ? false : !deviceConnected('scale');
}

function beanButton() {
    if (calculatorMode()) openFinalTds();
    else tareBean();
}

// --- Final TDS calculator ---
let ftYieldEdited = false;

function finalTdsOpen() {
    const modal = byId('finalTdsModal');
    return !!modal && modal.style.display !== 'none';
}

function openFinalTds() {
    if (!finalSnapshot || finalSnapshot.ciy == null) return;
    const input = byId('ftYield');
    // Re-opening keeps the yield that was entered last time
    ftYieldEdited = !!finalTds;
    input.value = finalTds ? finalTds.yieldG.toFixed(1) : '';
    showFieldError('ftError', '');
    byId('finalTdsModal').style.display = 'flex';
    renderFinalTdsDialog();
}

function closeFinalTds() {
    const modal = byId('finalTdsModal');
    if (modal) modal.style.display = 'none';
}

/** Scale, carafe, yield (scale - carafe until edited), CIY and TDS. */
function renderFinalTdsDialog() {
    if (!finalTdsOpen() || !finalSnapshot) return;
    const w = deviceConnected('scale') && lastScaleData ? lastScaleData.weight : null;
    const carafe = memory.carafe?.weight;
    setText('ftScale', w != null ? `${w.toFixed(1)} g` : '-- g');
    setText('ftCarafe', carafe != null ? `${carafe.toFixed(1)} g` : '--');
    const input = byId('ftYield');
    if (!ftYieldEdited && w != null) {
        const auto = (w - (carafe || 0)).toFixed(1);
        if (input.value !== auto) input.value = auto;
    }
    setText('ftCiy', formatCiy(finalSnapshot.ciy));
    // "uncalibrated" goes on a small second line so the value column stays narrow
    const tdsText = formatTds(tdsPercent(activeKv(), finalSnapshot.ciy, parseFloat(input.value)));
    const ftTds = byId('ftTds');
    ftTds.textContent = tdsText;
    if (!kv) ftTds.append(Object.assign(document.createElement('span'), { className: 'kv-uncalibrated', textContent: 'uncalibrated' }));
    byId('ftTareBtn').disabled = !deviceConnected('scale');
}

function applyFinalTds() {
    const yieldG = parseFloat(byId('ftYield').value);
    if (!(yieldG > 0)) {
        showFieldError('ftError', 'Enter the yield in grams.');
        byId('ftYield').focus();
        return;
    }
    finalTds = { yieldG, tds: tdsPercent(activeKv(), finalSnapshot.ciy, yieldG) };
    // Calibration uses this measured yield for the same brew
    const brew = loadJson(LAST_BREW_KEY);
    if (brew) saveLastBrew({ ...brew, yield: yieldG });
    updateLoggedBrewTds(yieldG, finalTds.tds);
    closeFinalTds();
    renderTdsPanel();
    renderYieldPanel();
    renderExtractionChart();
    showChartSlide(1);
    log(`Final TDS: ${formatTds(finalTds.tds)} from ${yieldG.toFixed(1)} g`);
}

function showFieldError(id, msg) {
    const el = byId(id);
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
}

function saveLastBrew(brew) { saveJson(LAST_BREW_KEY, brew); }

// --- Settings: retained ratio row (Edit turns the number into an input) ---
function renderAbsorptionSetting() {
    const display = byId('absorptionSettingValue');
    if (display) display.textContent = formatAbsorption(absorption);
}

function startAbsorptionEdit() {
    const cell = byId('absorptionSettingCell');
    const btn = byId('absorptionEditBtn');
    if (!cell || !btn || byId('absorptionInput')) return;
    cell.innerHTML = `<input type="number" id="absorptionInput" min="0" max="${MAX_ABSORPTION}" step="any" inputmode="decimal" aria-label="Retained ratio, grams of water held per gram of beans" value="${formatAbsorption(absorption)}"> g/g`;
    btn.textContent = 'Save';
    btn.onclick = saveAbsorptionEdit;
    const input = byId('absorptionInput');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveAbsorptionEdit(); }
        if (e.key === 'Escape') { e.stopPropagation(); endAbsorptionEdit(); }
    });
    input.addEventListener('input', () => showFieldError('absorptionError', ''));
    input.focus();
    input.select();
}

function saveAbsorptionEdit() {
    const input = byId('absorptionInput');
    if (!input) return;
    const a = input.value.trim() === '' ? NaN : Number(input.value);
    if (!(a >= 0 && a <= MAX_ABSORPTION)) {
        showFieldError('absorptionError', `Enter a number from 0 to ${MAX_ABSORPTION}.`);
        input.focus();
        return;
    }
    absorption = a;
    saveJson(ABSORPTION_KEY, a);
    endAbsorptionEdit();
    renderTdsPanel();
    log(`Retained ratio set to ${formatAbsorption(a)} g/g`);
}

function endAbsorptionEdit() {
    const cell = byId('absorptionSettingCell');
    const btn = byId('absorptionEditBtn');
    if (cell) cell.innerHTML = '<span id="absorptionSettingValue"></span> g/g';
    if (btn) { btn.textContent = 'Edit'; btn.onclick = startAbsorptionEdit; }
    showFieldError('absorptionError', '');
    renderAbsorptionSetting();
}

// --- Settings: k_v and its calibration (refractometer reading, then compare and save) ---
let calBrew = null; // last brew being calibrated against
let calKv = null; // k_v calculated in step 1

function renderKvSetting() {
    const cell = byId('kvSettingValue');
    if (cell) cell.innerHTML = kv ? formatKv(kv) : `${formatKv(DEFAULT_KV)}<span class="kv-uncalibrated">uncalibrated</span>`;
}

function setKv(v) {
    kv = v;
    saveJson(KV_KEY, v);
    renderKvSetting();
    renderTdsPanel();
}

function calibrationOpen() {
    const modal = byId('calibrateModal');
    return !!modal && modal.style.display !== 'none';
}

function showCalibrationStep(id) {
    for (const s of ['calEmpty', 'calStep1', 'calStep2']) byId(s).hidden = s !== id;
    const title = { calEmpty: 'calTitleEmpty', calStep1: 'calTitle1', calStep2: 'calTitle2' }[id];
    byId('calibrateModal').setAttribute('aria-labelledby', title);
}

function openCalibration() {
    const brew = loadJson(LAST_BREW_KEY);
    byId('calibrateModal').style.display = 'flex';
    if (!(brew?.ciy > 0)) {
        calBrew = null;
        showCalibrationStep('calEmpty');
        return;
    }
    calBrew = brew;
    setText('calBrewTime', formatShortDateTime(brew.at));
    setText('calCiy', formatCiy(brew.ciy));
    const y = brew.yield ?? brew.estYield;
    byId('calYield').value = y > 0 ? y.toFixed(1) : '';
    byId('calTds').value = '';
    showFieldError('calError', '');
    renderCalibrationKv();
    showCalibrationStep('calStep1');
    byId('calTds').focus();
}

function closeCalibration() {
    const modal = byId('calibrateModal');
    if (modal) modal.style.display = 'none';
}

/** k_v follows the yield and TDS as they are typed (read-only). */
function renderCalibrationKv() {
    const tds = parseFloat(byId('calTds').value);
    const y = parseFloat(byId('calYield').value);
    calKv = calBrew && tds >= MIN_CAL_TDS && tds <= MAX_CAL_TDS ? calcKv(tds, y, calBrew.ciy) : null;
    setText('calKv', formatKv(calKv));
}

function calibrationNext() {
    const y = parseFloat(byId('calYield').value);
    const tds = parseFloat(byId('calTds').value);
    if (!(y > 0)) {
        showFieldError('calError', 'Enter the yield in grams.');
        byId('calYield').focus();
        return;
    }
    if (!(tds >= MIN_CAL_TDS && tds <= MAX_CAL_TDS)) {
        showFieldError('calError', `Enter TDS as a percentage from ${MIN_CAL_TDS} to ${MAX_CAL_TDS}, like 1.38.`);
        byId('calTds').focus();
        return;
    }
    renderCalibrationKv();
    calBrew = { ...calBrew, yield: y };
    saveLastBrew(calBrew);
    setText('calCurrentKv', kv ? formatKv(kv) : `${formatKv(DEFAULT_KV)} (uncalibrated)`);
    byId('calNewKv').value = formatKv(calKv);
    showFieldError('calNewKvError', '');
    renderKvHistory();
    showCalibrationStep('calStep2');
}

function loadKvHistory() {
    const h = loadJson(KV_HISTORY_KEY);
    return Array.isArray(h) ? h.filter((e) => e?.kv > 0) : [];
}

/** Last 3 calibrations, newest first, with their average. */
function renderKvHistory() {
    const history = loadKvHistory().slice(0, 3);
    byId('calHistory').hidden = !history.length;
    const rows = history.map((e) => {
        const d = new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<tr><td>${d}</td><td>${formatKv(e.kv)}</td></tr>`;
    });
    if (history.length) {
        const avg = history.reduce((sum, e) => sum + e.kv, 0) / history.length;
        rows.push(`<tr class="tds-strong"><td>Average</td><td>${formatKv(avg)}</td></tr>`);
    }
    byId('calHistoryRows').innerHTML = rows.join('');
}

function pushKvHistory(value) {
    if (!(value > 0)) return;
    saveJson(KV_HISTORY_KEY, [{ at: Date.now(), kv: value }, ...loadKvHistory()].slice(0, 3));
}

/** Keep the current k_v; the calculated one still goes into the history. */
function keepCurrentKv() {
    pushKvHistory(calKv);
    closeCalibration();
}

/** Store the new k_v (as edited); it goes into the history too. */
function saveNewKv() {
    const input = byId('calNewKv');
    const v = input.value.trim() === '' ? NaN : Number(input.value);
    if (!(v > 0)) {
        showFieldError('calNewKvError', 'Enter a number above 0.');
        input.focus();
        return;
    }
    setKv(v);
    pushKvHistory(v);
    closeCalibration();
    log(`k_v set to ${formatKv(v)}`);
}

window.addEventListener('DOMContentLoaded', () => {
    renderKvSetting();
    endAbsorptionEdit();
    byId('ftYield').addEventListener('input', () => {
        ftYieldEdited = true;
        showFieldError('ftError', '');
        renderFinalTdsDialog();
    });
    for (const id of ['calYield', 'calTds']) {
        byId(id).addEventListener('input', () => { showFieldError('calError', ''); renderCalibrationKv(); });
    }
    byId('calNewKv').addEventListener('input', () => showFieldError('calNewKvError', ''));
    // Enter moves each dialog forward
    byId('ftYield').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyFinalTds(); } });
    byId('calTds').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calibrationNext(); } });
    byId('calNewKv').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNewKv(); } });
    // Clicking the backdrop closes a dialog
    for (const [id, close] of [['finalTdsModal', closeFinalTds], ['calibrateModal', closeCalibration]]) {
        byId(id).addEventListener('click', (e) => { if (e.target.id === id) close(); });
    }
    renderTdsPanel();
    renderBeanButton();
});

// --- After Stop: TDS vs extraction yield chart, as a second slide next to the brew chart ---
const EY_AXIS = { min: 14, max: 26, step: 2 }; // extraction yield %
const TDS_AXIS = { min: 0.8, max: 1.6, step: 0.2 }; // TDS %
const GOLD_CUP = { ey: [18, 22], tds: [1.15, 1.35] };
// Reference points; labels show after a tap on the chart
const EY_REFERENCE = [
    { ey: 16, tds: 1.5, label: ['Strong & Sour', '(Thick/Muddy)'] },
    { ey: 24, tds: 1.5, label: ['Strong & Bitter', '(Harsh/Heavy)'] },
    { ey: 16, tds: 0.9, label: ['Weak & Under-extracted', '(Thin/Watery)'] },
    { ey: 24, tds: 0.9, label: ['Weak & Over-extracted', '(Astringent/Dry)'] },
];
let extractionLabelsShown = false;

/** This brew on the chart: estimated (hollow) after Stop, measured (solid) after the calculator. */
function extractionPoint() {
    const dose = memory.beans?.weight;
    if (!finalSnapshot) {
        // Brewing: live estimate (if this cup stopped now), after the live TDS delay
        if (!liveExtractionActive() || recorder.elapsed() < tdsMinSeconds) return null;
        const tds = liveTds();
        const ey = extractionYield(estimatedYield(), tds, dose);
        return ey != null ? { ey, tds, final: false } : null;
    }
    if (finalSnapshot.ciy == null) return null;
    const final = !!finalTds;
    const tds = final ? finalTds.tds : finalSnapshot.estTds;
    const ey = extractionYield(final ? finalTds.yieldG : finalSnapshot.estYield, tds, dose);
    return ey != null ? { ey, tds, final } : null;
}

/** Live path while brewing: the scale and the EC meter are both connected. */
function liveExtractionActive() {
    return recorder.running && deviceConnected('scale') && deviceConnected('portal');
}

// The live estimates during this brew; drawn as a trail until the calculator's Next
let extractionTrail = [];

/** Each EC reading while brewing adds the current live estimate to the trail. */
function recordExtractionTrail() {
    const pt = extractionPoint();
    if (pt && !finalSnapshot) extractionTrail.push({ ey: pt.ey, tds: pt.tds, t: recorder.elapsed() });
}

function svgEl(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
}

function renderExtractionChart() {
    const svg = byId('extractionChart');
    const slide = byId('extractionSlide');
    if (!svg || !slide) return;
    // During a TDS brew (live path) and after one is stopped
    const show = finalSnapshot ? finalSnapshot.ciy != null : liveExtractionActive();
    slide.hidden = !show;
    byId('chartDots').hidden = !show;
    if (!show) return;
    const point = extractionPoint();
    let hint = null;
    if (!point && !(memory.beans?.weight > 0)) hint = 'Set the bean dose to plot this brew';
    else if (!point && !finalSnapshot && recorder.elapsed() < tdsMinSeconds) hint = `Live path from ${formatSeconds(tdsMinSeconds)}`;
    // The live trail stays after Next, with the measured final dot drawn on top
    const desc = drawExtractionChart(svg, {
        point,
        trail: extractionTrail,
        labelsShown: extractionLabelsShown,
        hint,
        estimateWord: finalSnapshot ? 'estimated' : 'live estimate:',
    });
    svg.setAttribute('aria-label', `TDS versus extraction yield chart, ${desc}. Tap to ${extractionLabelsShown ? 'hide' : 'show'} region labels.`);
}

/**
 * Draw the TDS vs extraction chart into an <svg> (also used by the brew log).
 * point: {ey, tds, final} or null; trail: [{ey, tds}]; returns a description for aria-label.
 */
function drawExtractionChart(svg, { point = null, trail = [], labelsShown = false, hint = null, estimateWord = 'estimated' } = {}) {
    const w = svg.clientWidth || 300;
    const h = svg.clientHeight || 150;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.replaceChildren();
    // Bottom: tick numbers, then the x-axis title. With --chart-font set (tablet, brew log on a tablet)
    // the chart sits under the brew chart, so it uses the brew chart's margins and the axes line up.
    const fontPx = parseFloat(getComputedStyle(svg).getPropertyValue('--chart-font'));
    const s = fontPx > 0 ? fontPx / 11 : 0;
    const pad = s ? { l: 34 * s, r: 28 * s, t: 8, b: 30 * s } : { l: 32, r: 10, t: 8, b: 30 };
    const x = (ey) => pad.l + ((ey - EY_AXIS.min) / (EY_AXIS.max - EY_AXIS.min)) * (w - pad.l - pad.r);
    const y = (tds) => h - pad.b - ((tds - TDS_AXIS.min) / (TDS_AXIS.max - TDS_AXIS.min)) * (h - pad.t - pad.b);

    // Grid and ticks
    for (let v = EY_AXIS.min; v <= EY_AXIS.max + 1e-9; v += EY_AXIS.step) {
        svg.append(svgEl('text', { x: x(v), y: h - pad.b + 12 * (s || 1), 'text-anchor': 'middle', class: 'ey-tick' }, String(v)));
    }
    // x-axis title, bottom right (the y-axis title "TDS · %" is in the card header)
    svg.append(svgEl('text', { x: w - pad.r, y: h - 4, 'text-anchor': 'end', class: 'ey-axis-title' }, 'Extraction · %'));
    for (let v = TDS_AXIS.min; v <= TDS_AXIS.max + 1e-9; v += TDS_AXIS.step) {
        svg.append(svgEl('line', { x1: x(EY_AXIS.min), x2: x(EY_AXIS.max), y1: y(v), y2: y(v), class: 'ey-grid' }));
        svg.append(svgEl('text', { x: pad.l - 5, y: y(v) + 3.5, 'text-anchor': 'end', class: 'ey-tick' }, v.toFixed(1)));
    }
    // Gold cup zone (no label)
    svg.append(svgEl('rect', {
        x: x(GOLD_CUP.ey[0]), y: y(GOLD_CUP.tds[1]),
        width: x(GOLD_CUP.ey[1]) - x(GOLD_CUP.ey[0]), height: y(GOLD_CUP.tds[0]) - y(GOLD_CUP.tds[1]),
        class: 'ey-gold',
    }));
    // Reference points; top-row labels go below the point, bottom-row labels above
    for (const p of EY_REFERENCE) {
        svg.append(svgEl('circle', { cx: x(p.ey), cy: y(p.tds), r: 3.5, class: 'ey-ref' }));
        if (!labelsShown && !isTablet()) continue;
        const left = p.ey < 20;
        const top = p.tds > 1.2;
        const text = svgEl('text', { x: x(p.ey) + (left ? -4 : 4), y: y(p.tds), 'text-anchor': left ? 'start' : 'end', class: 'ey-label' });
        // Offsets in em, so the labels clear the point at any font size
        const first = top ? 1.55 : -(1.2 * (p.label.length - 1) + 0.8);
        p.label.forEach((line, i) => text.append(svgEl('tspan', { x: x(p.ey) + (left ? -4 : 4), dy: `${i ? 1.2 : first}em` }, line)));
        svg.append(text);
    }
    // Trail, clipped at the chart edges rather than pinned, so it enters the chart where it really does
    if (trail.length > 1) {
        const clipId = `eyClip-${svg.id || 'chart'}`;
        const clip = svgEl('clipPath', { id: clipId });
        clip.append(svgEl('rect', { x: x(EY_AXIS.min), y: y(TDS_AXIS.max), width: x(EY_AXIS.max) - x(EY_AXIS.min), height: y(TDS_AXIS.min) - y(TDS_AXIS.max) }));
        svg.append(clip);
        svg.append(svgEl('polyline', { points: trail.map((p) => `${x(p.ey)},${y(p.tds)}`).join(' '), class: 'ey-trail', 'clip-path': `url(#${clipId})` }));
    }
    // This brew (pinned to the edge, with the real values in its label, if it is off the chart)
    const px = (ey) => x(Math.min(EY_AXIS.max, Math.max(EY_AXIS.min, ey)));
    const py = (tds) => y(Math.min(TDS_AXIS.max, Math.max(TDS_AXIS.min, tds)));
    let desc = 'no TDS for this brew yet';
    if (point) {
        const cx = px(point.ey);
        const cy = py(point.tds);
        svg.append(svgEl('circle', { cx, cy, r: 5.5, class: point.final ? 'ey-brew' : 'ey-brew ey-brew-estimate' }));
        const right = cx < w / 2;
        const below = cy < pad.t + 14;
        // The region labels take over while they are shown; the dot stays
        if (!labelsShown || isTablet()) svg.append(svgEl('text', { x: cx + (right ? 9 : -9), y: cy + (below ? 14 : -8), 'text-anchor': right ? 'start' : 'end', class: 'ey-brew-label' },
            `${point.final ? '' : '≈ '}${point.ey.toFixed(1)} %, ${point.tds.toFixed(2)} %`));
        desc = `${point.final ? '' : `${estimateWord} `}extraction ${point.ey.toFixed(1)} %, TDS ${point.tds.toFixed(2)} %: ${extractionRegion(point.tds, point.ey)}`;
    } else if (hint) {
        svg.append(svgEl('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', class: 'ey-hint' }, hint));
        if (hint.startsWith('Live path')) desc = 'live path starts shortly';
    }
    return desc;
}

function toggleExtractionLabels() {
    extractionLabelsShown = !extractionLabelsShown;
    renderExtractionChart();
}

/** Scroll the chart carousel to a slide (0 = brew chart, 1 = TDS vs extraction). */
function showChartSlide(i, smooth = true) {
    const track = byId('chartTrack');
    if (!track) return;
    track.scrollTo({ left: i * track.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
    renderChartDots(i);
}

function renderChartDots(i) {
    const track = byId('chartTrack');
    const active = i ?? (track && track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0);
    document.querySelectorAll('#chartDots .chart-dot').forEach((d, n) => d.setAttribute('aria-current', String(n === active)));
    // The legend belongs to the brew chart (on a tablet both charts are always shown)
    const legend = document.getElementById('brewChartLabel');
    if (legend) legend.style.visibility = active === 1 && !isTablet() ? 'hidden' : '';
}

window.addEventListener('DOMContentLoaded', () => {
    const svg = byId('extractionChart');
    svg.addEventListener('click', toggleExtractionLabels);
    svg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExtractionLabels(); }
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => renderExtractionChart()).observe(svg);
    byId('chartTrack').addEventListener('scroll', () => renderChartDots(), { passive: true });
    renderChartDots(0);
});

// --- Brew log: every stopped brew is saved (summary + chart points); Settings > Brew log ---
const brewLog = new BrewLog();
sync = new Sync({ brewLog, onSettings: reloadSyncedSettings, onBrews: brewsSynced, onStatus: renderSyncStatus });
brewLog.onChange = () => sync.schedule();
let currentLogId = null; // the brew saved at the last Stop (updated by the calculator)
let openLogBrew = null; // the brew shown in the detail view
let logChart = null;
let logChartData = null;
let logNav = 0; // bumped on every navigation, so a slow load can't reopen a view you've left

function fmtGrams(v) { return String(Number(v.toFixed(1))); } // 20, 18.5
function logDefaultName(at) { return formatShortDateTime(at); }
function logName(brew) { return brew.name || logDefaultName(brew.at); }

/** Snapshot of the stopped brew for the log (null if nothing was recorded). */
function buildLogEntry() {
    const rows = recorder.rows;
    const f = finalSnapshot;
    if (!rows.length || !f || !recorder.startedAt) return null;
    const weight = downsample(rows.filter((r) => r.source === 'scale' && r.weight != null).map((r) => ({ t: r.t, v: r.weight })));
    const ec = downsample(rows.filter((r) => r.source === 'portal' && r.ec != null).map((r) => ({ t: r.t, v: r.ec })));
    const dose = memory.beans?.weight > 0 ? memory.beans.weight : null;
    const at = recorder.startedAt.getTime();
    return {
        id: at,
        at,
        name: null,
        summary: {
            hasScale: weight.length > 0,
            hasEc: ec.length > 0,
            ms: f.ms,
            elapsed: recorder.elapsed(),
            finalWeight: f.weight,
            avgFlow: f.avgFlow,
            dose,
            target: targetWeight,
            ratio: dose && f.weight != null ? f.weight / dose : null,
            tempAtStop: f.temp,
            peakEc: f.peakEc,
            ciy: f.ciy,
            estYield: f.estYield,
            estTds: f.estTds,
            yield: null,
            tds: null,
            kv: f.ciy != null ? activeKv() : null,
            kvCalibrated: !!kv,
            absorption,
        },
        // The live TDS vs extraction path (estimates while brewing), for the log's chart
        series: { weight, ec, trail: downsample(extractionTrail) },
    };
}

/** Called at Stop: save this brew to the log. */
function saveBrewToLog() {
    const entry = buildLogEntry();
    if (!entry) return;
    currentLogId = entry.id;
    brewLog.save(entry).then(refreshLogCount).catch((e) => log(`Brew log save failed: ${e.message}`));
}

/** Called by the calculator's Next: the measured yield and final TDS. */
function updateLoggedBrewTds(yieldG, tds) {
    if (currentLogId == null) return;
    brewLog.update(currentLogId, { summary: { yield: yieldG, tds } }).catch((e) => log(`Brew log update failed: ${e.message}`));
}

async function refreshLogCount() {
    const el = byId('brewLogCount');
    if (!el) return;
    const n = await brewLog.count().catch(() => 0);
    el.textContent = n ? `${n} brew${n === 1 ? '' : 's'}` : '';
}

function brewLogOpen() {
    const modal = byId('brewLogModal');
    return !!modal && modal.style.display !== 'none';
}

async function openBrewLog() {
    byId('brewLogModal').style.display = 'flex';
    await showBrewList();
}

function closeBrewLog() {
    logNav++;
    refreshChart();
    const modal = byId('brewLogModal');
    if (modal) modal.style.display = 'none';
    openLogBrew = null;
}

/** List view: newest first, with dose -> yield (or final weight) and TDS. */
async function showBrewList() {
    const nav = ++logNav;
    endLogRename(false);
    openLogBrew = null;
    byId('logDetailView').hidden = true;
    byId('logListView').hidden = false;
    byId('brewLogModal').setAttribute('aria-labelledby', 'brewLogTitle');
    const brews = await brewLog.list().catch(() => []);
    if (nav !== logNav) return;
    setText('logCount', `${brews.length} of ${MAX_BREWS}`);
    byId('logEmpty').hidden = brews.length > 0;
    const list = byId('logList');
    list.replaceChildren(...brews.map((b) => {
        const s = b.summary;
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'log-item';
        btn.dataset.id = String(b.id);
        btn.onclick = () => openBrewDetail(b.id);
        const left = document.createElement('div');
        left.append(
            Object.assign(document.createElement('div'), { className: 'log-item-name', textContent: logName(b) }),
            Object.assign(document.createElement('div'), { className: 'log-item-sub', textContent: `${new Date(b.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${formatSeconds(s.ms / 1000)}` }),
        );
        const right = document.createElement('div');
        right.className = 'log-item-right';
        const out = s.ciy != null ? s.yield ?? s.estYield : s.finalWeight;
        if (s.hasScale && out != null) right.append(Object.assign(document.createElement('div'), { textContent: s.dose ? `${fmtGrams(s.dose)}g → ${fmtGrams(out)}g` : `${fmtGrams(out)}g` }));
        const tds = s.tds ?? s.estTds;
        if (s.ciy != null && tds != null) right.append(Object.assign(document.createElement('div'), { className: 'log-item-sub', textContent: `TDS ${s.tds != null ? '' : '≈ '}${tds.toFixed(2)} %` }));
        else if (!s.hasScale && s.peakEc != null) right.append(Object.assign(document.createElement('div'), { className: 'log-item-sub', textContent: `Peak EC ${s.peakEc.toFixed(2)}` }));
        btn.append(left, right);
        li.append(btn);
        return li;
    }));
    // Tablet: the newest brew (or the one already open) shows next to the list
    if (isTablet() && brews.length) await openBrewDetail((brews.find((b) => b.id === logSelectedId) ?? brews[0]).id);
}
let logSelectedId = null; // the brew open next to the list (tablet)

/** Detail view: static charts and the final data for one brew. */
async function openBrewDetail(id) {
    const nav = ++logNav;
    const brew = await brewLog.get(id);
    if (nav !== logNav || !brewLogOpen()) return;
    if (!brew) return showBrewList();
    openLogBrew = brew;
    logSelectedId = brew.id;
    document.querySelectorAll('#logList .log-item').forEach((b) => b.classList.toggle('is-selected', b.dataset.id === String(id)));
    byId('logListView').hidden = !isTablet();
    byId('logDetailView').hidden = false;
    byId('brewLogModal').setAttribute('aria-labelledby', 'logName');
    byId('logDeleteConfirm').hidden = true;
    byId('logDeleteBtn').hidden = false;
    renderBrewDetail();
}

function renderBrewDetail() {
    const brew = openLogBrew;
    if (!brew) return;
    const s = brew.summary;
    setText('logName', logName(brew));
    const d = new Date(brew.at);
    setText('logDate', `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);

    // Brew chart: EC (with weight) if the EC meter was used, otherwise weight with the target line
    const dual = s.hasEc && s.hasScale;
    logChartData = {
        mode: s.hasEc ? 'ec' : 'weight',
        points: s.hasEc ? brew.series.ec : brew.series.weight,
        weightPoints: dual ? brew.series.weight : null,
        elapsed: s.elapsed,
        target: s.target,
        running: false,
    };
    byId('logBrewChartLabel').innerHTML = !s.hasEc ? '<span class="brew-chart-label-weight">Weight · g</span>'
        : dual ? '<span class="brew-chart-label-weight">Weight · g</span><span class="brew-chart-label-ec">EC · mS/cm</span>' : '<span class="brew-chart-label-ec">EC · mS/cm</span>';
    if (!logChart) logChart = new BrewChart(byId('logBrewChart'), () => logChartData);
    logChart.requestDraw();

    // TDS vs extraction: only for brews with both devices (CIY)
    const tdsBrewLogged = s.ciy != null;
    byId('logEyChartBox').hidden = !tdsBrewLogged;
    const tds = s.tds ?? s.estTds;
    const yieldG = s.yield ?? s.estYield;
    const ey = tdsBrewLogged ? extractionYield(yieldG, tds, s.dose) : null;
    if (tdsBrewLogged) {
        const svg = byId('logEyChart');
        const point = ey != null ? { ey, tds, final: s.tds != null } : null;
        // Brews saved before the trail was stored have none: just the dot
        const desc = drawExtractionChart(svg, { point, trail: brew.series.trail || [], hint: point ? null : 'No extraction for this brew' });
        svg.setAttribute('aria-label', `TDS versus extraction yield chart, ${desc}.`);
    }

    // Summary row: time, ratio (with the scale), then TDS / final weight / peak EC
    const uncal = s.kvCalibrated ? '' : ' (uncal.)';
    const summary = [['Time', formatSeconds(s.ms / 1000)]];
    if (s.hasScale) summary.push(['Ratio', s.ratio ? `1:${s.ratio.toFixed(1)}` : '--']);
    if (tdsBrewLogged) summary.push([`${s.tds != null ? 'TDS' : 'TDS ≈'}${uncal}`, formatTds(tds)]);
    else if (s.hasScale) summary.push(['Final weight', s.finalWeight != null ? `${s.finalWeight.toFixed(1)} g` : '--']);
    else if (s.hasEc) summary.push(['Peak EC', s.peakEc != null ? `${s.peakEc.toFixed(2)} mS/cm` : '--']);
    byId('logSummary').replaceChildren(...summary.map(([label, value]) => {
        const item = document.createElement('div');
        item.append(
            Object.assign(document.createElement('b'), { className: 'log-summary-value', textContent: value }),
            Object.assign(document.createElement('span'), { className: 'log-summary-label', textContent: label }),
        );
        return item;
    }));

    // Grouped cards: Brew (scale), Extraction (both devices), EC meter
    const groups = [];
    if (s.hasScale) {
        const brewCards = [];
        if (tdsBrewLogged) brewCards.push(['Final weight', s.finalWeight != null ? `${s.finalWeight.toFixed(1)} g` : '--']);
        brewCards.push(['Avg flow', s.avgFlow != null ? `${s.avgFlow.toFixed(1)} g/s` : '--']);
        brewCards.push(['In → out', s.dose && s.target ? `${fmtGrams(s.dose)}g → ${fmtGrams(s.target)}g` : '--']);
        groups.push(['Brew', brewCards]);
    }
    if (tdsBrewLogged) {
        groups.push(['Extraction', [
            [s.yield != null ? 'Yield' : 'Yield ≈', yieldG != null ? `${yieldG.toFixed(1)} g` : '--'],
            ['Extraction', ey != null ? `${ey.toFixed(1)} %` : '--'],
            ['CIY', formatCiy(s.ciy)],
        ]]);
    }
    if (s.hasEc) {
        const ecCards = [['Temp at stop', s.tempAtStop != null ? `${s.tempAtStop.toFixed(1)} °C` : '--']];
        if (s.hasScale || tdsBrewLogged) ecCards.push(['Peak EC', s.peakEc != null ? `${s.peakEc.toFixed(2)} mS/cm` : '--']);
        if (tdsBrewLogged) ecCards.push([`kᵥ${uncal}`, formatKv(s.kv)]);
        groups.push(['EC meter', ecCards]);
    }
    byId('logCards').replaceChildren(...groups.flatMap(([title, cards]) => {
        const heading = Object.assign(document.createElement('p'), { className: 'settings-group log-group', textContent: title });
        const grid = document.createElement('div');
        grid.className = 'log-cards';
        grid.append(...cards.map(([label, value]) => {
            const item = document.createElement('div');
            item.className = 'ritual-info-item';
            item.append(
                Object.assign(document.createElement('div'), { className: 'ritual-info-label', textContent: label }),
                Object.assign(document.createElement('div'), { className: 'ritual-info-value', textContent: value }),
            );
            return item;
        }));
        return [heading, grid];
    }));
}

let logPencilHtml = null; // the rename button's icon, restored after editing

// Rename: the name becomes a text input; Enter or Save stores it, Escape cancels
function startLogRename() {
    if (!openLogBrew || byId('logNameInput')) return;
    const h = byId('logName');
    const input = Object.assign(document.createElement('input'), { type: 'text', id: 'logNameInput', className: 'log-name-input', maxLength: 60, value: logName(openLogBrew) });
    input.setAttribute('aria-label', 'Brew name');
    h.replaceChildren(input);
    const btn = byId('logRenameBtn');
    if (logPencilHtml == null) logPencilHtml = btn.innerHTML;
    btn.textContent = 'Save';
    btn.classList.add('is-saving');
    btn.setAttribute('aria-label', 'Save name');
    btn.onclick = () => endLogRename(true);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); endLogRename(true); }
        if (e.key === 'Escape') { e.stopPropagation(); endLogRename(false); }
    });
    input.addEventListener('input', () => showFieldError('logRenameError', ''));
    input.focus();
    input.select();
}

async function endLogRename(save) {
    const input = byId('logNameInput');
    const btn = byId('logRenameBtn');
    if (input && save) {
        const name = input.value.trim();
        if (!name) {
            showFieldError('logRenameError', 'Enter a name.');
            input.focus();
            return;
        }
        openLogBrew = await brewLog.update(openLogBrew.id, { name });
    }
    if (btn && logPencilHtml != null) {
        btn.innerHTML = logPencilHtml;
        btn.classList.remove('is-saving');
        btn.setAttribute('aria-label', 'Rename');
        btn.onclick = startLogRename;
    }
    showFieldError('logRenameError', '');
    if (openLogBrew) setText('logName', logName(openLogBrew));
}

// Delete asks first (it can't be undone)
function askDeleteBrew() {
    byId('logDeleteBtn').hidden = true;
    byId('logDeleteConfirm').hidden = false;
}
function cancelDeleteBrew() {
    byId('logDeleteConfirm').hidden = true;
    byId('logDeleteBtn').hidden = false;
}
async function deleteBrew() {
    if (!openLogBrew) return;
    const id = openLogBrew.id;
    await brewLog.remove(id);
    sync?.markBrewDeleted(id);
    if (currentLogId === id) currentLogId = null;
    await refreshLogCount();
    await showBrewList();
}

/** Escape in the brew log: cancel delete, then back to the list, then close. */
function brewLogEscape() {
    if (!byId('logDeleteConfirm').hidden) cancelDeleteBrew();
    else if (!byId('logDetailView').hidden && !isTablet()) showBrewList();
    else closeBrewLog();
}

window.addEventListener('DOMContentLoaded', () => {
    renderTdsPanel(); // the tablet's readings, before any device connects
    TABLET_QUERY?.addEventListener?.('change', () => {
        renderConnectionState();
        if (finalSnapshot) renderFinal();
        else if (lastScaleData && deviceConnected('scale')) updateDisplay(lastScaleData);
        renderTdsPanel();
        refreshChart();
        if (brewLogOpen()) showBrewList();
        renderChartDots();
    });
    refreshLogCount();
    byId('brewLogModal').addEventListener('click', (e) => { if (e.target.id === 'brewLogModal') closeBrewLog(); });
});

// Expose for HTML
window.openRatioSlider = openRatioSlider;
window.closeRatioSlider = closeRatioSlider;
window.switchBrewMode = switchBrewMode;
// Attach UI functions to window for HTML onclick compatibility
// Do not expose openSettingsModal globally to prevent accidental opening.
// Instead attach explicit click handler to the settings button below.
window.closeSettingsModal = closeSettingsModal;
window.setFlowSymbol = setFlowSymbol;
window.connectToScale = connectToScale;
window.connectDevices = connectDevices;
window.sendTareCommand = sendTareCommand;
window.sendTareAndStartCommand = sendTareAndStartCommand;
window.sendStartTimerCommand = sendStartTimerCommand;
window.sendStopTimerCommand = sendStopTimerCommand;
window.sendResetTimerCommand = sendResetTimerCommand;
window.setBeepLevel = setBeepLevel;
window.setAutoOff = setAutoOff;
window.setFlowSmoothing = setFlowSmoothing;
window.tareBean = tareBean;
window.disconnect = disconnect;
window.triStateTimer = triStateTimer;
window.toggleConnect = toggleConnect;
window.connectFromIcon = connectFromIcon;
window.connectFromChart = connectFromChart;
window.exportBrewCsv = exportBrewCsv;
window.startRatioEdit = startRatioEdit;
window.beanButton = beanButton;
window.closeFinalTds = closeFinalTds;
window.applyFinalTds = applyFinalTds;
window.startAbsorptionEdit = startAbsorptionEdit;
window.openCalibration = openCalibration;
window.closeCalibration = closeCalibration;
window.calibrationNext = calibrationNext;
window.keepCurrentKv = keepCurrentKv;
window.saveNewKv = saveNewKv;
window.showChartSlide = showChartSlide;
window.openBrewLog = openBrewLog;

// --- Trim: after Stop, move the end of the brew earlier (Stop was pressed late). Optional. ---

function lastOf(rows, key) {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return rows[i][key];
    return null;
}

/** The stopped brew's values as if Stop had been pressed at t seconds. */
function snapshotAt(t) {
    const base = fullSnapshot;
    const rows = recorder.allRows().filter((r) => r.t <= t);
    const weight = lastOf(rows.filter((r) => r.source === 'scale'), 'weight') ?? base.weight;
    const ecs = rows.filter((r) => r.source === 'portal' && r.ec != null).map((r) => r.ec);
    const tdsBrewHere = base.ciy != null;
    const ciyAt = tdsBrewHere ? lastOf(rows, 'ciy') : null;
    const estYield = tdsBrewHere && weight != null ? liveYield(weight - (ciy.baseline ?? 0), memory.beans?.weight, absorption) : null;
    return {
        ...base,
        ms: t * 1000,
        weight,
        avgFlow: weight != null && t > 0 ? weight / t : null,
        peakEc: ecs.length ? Math.max(...ecs) : base.peakEc,
        temp: base.temp != null ? lastOf(rows, 'temp') : null,
        ciy: ciyAt,
        estYield,
        estTds: tdsBrewHere ? tdsPercent(activeKv(), ciyAt, estYield) : null,
    };
}

/** Show the values for an end time (while trimming, the chart keeps the whole brew). */
function showEnd(t) {
    // At Stop (no trim): exactly the values captured then
    finalSnapshot = t >= recorder.fullElapsed() - 0.5 ? fullSnapshot : snapshotAt(t);
    if (finalTds) finalTds = { ...finalTds, tds: tdsPercent(activeKv(), finalSnapshot.ciy, finalTds.yieldG) };
    renderFinal();
}

/** Where the weight dropped by more than 40 g (dripper lifted off): the brew had ended there. */
function suggestedEnd() {
    let max = -Infinity;
    let atMax = null;
    for (const r of recorder.allRows()) {
        if (r.source !== 'scale' || r.weight == null) continue;
        if (r.weight >= max) { max = r.weight; atMax = r.t; }
        else if (max - r.weight > 40) return atMax;
    }
    return null;
}

/** The brew chart's plot area (same margins as BrewChart) and its time span. */
function trimGeometry() {
    const canvas = byId('brewChartCanvas');
    const s = (parseFloat(getComputedStyle(canvas).getPropertyValue('--chart-font')) || 11) / 11;
    const d = chartData();
    const dual = d.mode === 'ec' && Array.isArray(d.weightPoints);
    const left = 34 * s;
    const right = (dual ? 28 : 12) * s;
    const rows = recorder.allRows();
    const lastT = rows.length ? rows[rows.length - 1].t : 0;
    return { left, plotW: canvas.clientWidth - left - right, span: Math.max(d.elapsed, lastT, 30) };
}

function renderTrim() {
    const g = trimGeometry();
    const x = g.left + (trimEnd / g.span) * g.plotW;
    byId('trimLine').style.left = `${x}px`;
    Object.assign(byId('trimShade').style, { left: `${x}px`, width: `${Math.max(0, g.left + g.plotW - x)}px` });
    setText('trimTime', formatSeconds(trimEnd));
    const overlay = byId('trimOverlay');
    overlay.setAttribute('aria-valuetext', formatSeconds(trimEnd));
    setText('trimApplyBtn', trimEnd >= Math.round(recorder.fullElapsed()) ? 'Keep all' : `Trim to ${formatSeconds(trimEnd)}`);
    showEnd(trimEnd);
    refreshChart(); // the floating values follow the line
}

/** "Trim" after Stop; "Trimmed" once trimmed (tap to change). */
function renderTrimButton() {
    const btn = byId('trimBtn');
    if (!btn) return;
    btn.hidden = !finalSnapshot || trimMode || !recorder.allRows().length;
    const trimmed = recorder.trimmed;
    btn.classList.toggle('is-trimmed', trimmed);
    btn.setAttribute('aria-label', trimmed ? `Trimmed to ${formatSeconds(recorder.elapsed())}. Change the end of the brew` : 'Trim the end of the brew');
    setText('trimBtnLabel', trimmed ? 'Trimmed' : 'Trim');
}

function startTrim() {
    if (!finalSnapshot) return;
    fullSnapshot = fullSnapshot ?? finalSnapshot;
    const current = recorder.elapsed();
    const trimmed = recorder.trimmed;
    trimBefore = trimmed ? current : null;
    recorder.setEnd(null); // the whole brew is shown while choosing
    trimMode = true;
    document.body.classList.add('trimming');
    const suggestion = trimmed ? null : suggestedEnd();
    trimEnd = Math.round(suggestion ?? current);
    setText('trimHint', suggestion != null ? `Weight dropped at ${formatSeconds(suggestion)} (dripper lifted). Drag to adjust.` : 'Drag the line to where the brew ended.');
    for (const id of ['trimOverlay', 'trimBar', 'trimHint']) byId(id).hidden = false;
    renderLiveStrip();
    renderTrimButton();
    requestAnimationFrame(renderTrim);
    byId('trimOverlay').focus({ preventScroll: true });
}

function endTrimMode() {
    trimMode = false;
    document.body.classList.remove('trimming');
    for (const id of ['trimOverlay', 'trimBar', 'trimHint']) byId(id).hidden = true;
    renderLiveStrip();
    renderTrimButton();
    refreshChart();
}

/** Back to the end that was in use before (the full brew, or the earlier trim). */
function cancelTrim() {
    recorder.setEnd(trimBefore);
    endTrimMode();
    showEnd(recorder.elapsed());
}

function applyTrim() {
    recorder.setEnd(trimEnd);
    extractionTrail = extractionTrail.filter((p) => p.t == null || p.t <= recorder.elapsed());
    endTrimMode();
    showEnd(recorder.elapsed());
    saveTrimmedBrew();
}

/** The brew log entry (and the brew used for calibration) follow the trim. */
function saveTrimmedBrew() {
    const entry = buildLogEntry();
    if (entry && currentLogId != null) {
        brewLog.update(currentLogId, { summary: { ...entry.summary, yield: finalTds?.yieldG ?? null, tds: finalTds?.tds ?? null }, series: entry.series })
            .catch((e) => log(`Brew log update failed: ${e.message}`));
    }
    if (finalSnapshot.ciy != null) {
        const brew = loadJson(LAST_BREW_KEY);
        saveLastBrew({ ...(brew || {}), ciy: finalSnapshot.ciy, estYield: finalSnapshot.estYield, at: brew?.at ?? Date.now() });
    }
}

function nudgeTrim(d) {
    trimEnd = Math.min(Math.max(1, trimEnd + d), Math.round(recorder.fullElapsed()));
    renderTrim();
}

window.addEventListener('DOMContentLoaded', () => {
    const overlay = byId('trimOverlay');
    const move = (e) => {
        const g = trimGeometry();
        const t = ((e.clientX - overlay.getBoundingClientRect().left - g.left) / g.plotW) * g.span;
        trimEnd = Math.min(Math.max(1, Math.round(t)), Math.round(recorder.fullElapsed()));
        renderTrim();
    };
    overlay.addEventListener('pointerdown', (e) => { overlay.setPointerCapture(e.pointerId); move(e); });
    overlay.addEventListener('pointermove', (e) => { if (overlay.hasPointerCapture(e.pointerId)) move(e); });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeTrim(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); nudgeTrim(1); }
        if (e.key === 'Enter') { e.preventDefault(); applyTrim(); }
    });
});
window.startTrim = startTrim;
window.cancelTrim = cancelTrim;
window.applyTrim = applyTrim;
window.nudgeTrim = nudgeTrim;

// --- Sync: settings and brew log shared between devices (Settings > Sync) ---

/** Settings changed on another device: read them again and show them. */
function reloadSyncedSettings() {
    loadMemory(); // also recomputes the target
    currentRatio = loadRatio();
    renderRatioSetting();
    recomputeTarget();
    kv = loadKv();
    renderKvSetting();
    absorption = loadAbsorption();
    renderAbsorptionSetting();
    loadTimerDrives();
    renderTdsPanel();
}

/** Brews came from another device: refresh the count and whatever part of the log is open. */
function brewsSynced() {
    refreshLogCount();
    if (!brewLogOpen()) return;
    if (openLogBrew && !isTablet()) openBrewDetail(openLogBrew.id);
    else showBrewList();
}

function syncOpen() {
    const modal = byId('syncModal');
    return !!modal && modal.style.display !== 'none';
}

/** "10:24 a.m." today, otherwise "Oct 20, 10:24 a.m." */
function formatSyncTime(at) {
    const d = new Date(at);
    return d.toDateString() === new Date().toDateString()
        ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : formatShortDateTime(at);
}

function renderSyncStatus(st = sync.status()) {
    const meta = !st.configured ? 'Off' : st.syncing ? 'Syncing…' : st.error ? 'Not synced' : st.lastSync ? formatSyncTime(st.lastSync) : 'On';
    setText('syncRowMeta', meta);
    if (!syncOpen()) return;
    setText('syncStatus', st.configured && st.lastSync ? `Last synced ${formatSyncTime(st.lastSync)}` : '');
    showFieldError('syncError', st.configured && !st.syncing && st.error ? st.error : '');
    byId('syncOffBtn').hidden = !st.configured;
    byId('syncSaveBtn').disabled = st.syncing;
    byId('syncSaveBtn').textContent = st.configured ? 'Save and sync' : 'Turn on';
}

function openSync() {
    const config = sync.config;
    byId('syncUrl').value = config?.url || '';
    const token = byId('syncToken');
    token.value = '';
    token.placeholder = config?.token ? 'Saved on this device' : "From the server's .env";
    byId('syncModal').style.display = 'flex';
    renderSyncStatus();
    (config ? byId('syncSaveBtn') : byId('syncUrl')).focus();
}

function closeSync() {
    const modal = byId('syncModal');
    if (modal) modal.style.display = 'none';
}

async function saveSync() {
    const token = byId('syncToken').value || sync.config?.token || '';
    try {
        sync.setConfig({ url: byId('syncUrl').value, token });
    } catch (e) {
        showFieldError('syncError', e.message);
        return;
    }
    byId('syncToken').value = '';
    byId('syncToken').placeholder = 'Saved on this device';
    await sync.sync().catch(() => {}); // the status line shows any error
}

function turnSyncOff() {
    sync.turnOff();
    byId('syncToken').placeholder = "From the server's .env";
}

window.openSync = openSync;
window.closeSync = closeSync;
window.saveSync = saveSync;
window.turnSyncOff = turnSyncOff;
window.__test_sync = sync;

window.addEventListener('DOMContentLoaded', () => {
    renderSyncStatus();
    for (const id of ['syncUrl', 'syncToken']) {
        byId(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveSync(); } });
        byId(id).addEventListener('input', () => showFieldError('syncError', ''));
    }
    byId('syncModal').addEventListener('click', (e) => { if (e.target.id === 'syncModal') closeSync(); });
    // Sync when the app opens and when it comes back to the front
    sync.schedule(800);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.schedule(500); });
});
window.closeBrewLog = closeBrewLog;
window.showBrewList = showBrewList;
window.startLogRename = startLogRename;
window.askDeleteBrew = askDeleteBrew;
window.cancelDeleteBrew = cancelDeleteBrew;
window.deleteBrew = deleteBrew;

// Test helpers (test-only): allow E2E tests to inject memory and update UI deterministically.
window.__test_setMemory = (m) => {
    try {
        memory = Object.assign({}, memory, m);
        updateMemoryTable();
    } catch (e) {
        // ignore in production
    }
};
window.__test_updateDisplay = (data) => {
    try {
        updateDisplay(data);
    } catch (e) {
        // ignore in production
    }
};

// BLE mock helpers for tests
window.__test_setConnected = (connected) => {
    // Toggle the scale's UI connected state without real BLE
    testConnected.scale = !!connected;
    renderConnectionState();
};
window.__test_setPortalConnected = (connected) => {
    testConnected.portal = !!connected;
    renderConnectionState();
};
window.__test_disconnect = () => {
    // Simulate disconnect cleanup
    testConnected.scale = false;
    testConnected.portal = false;
    onScaleDisconnected();
    resetPortalDisplay();
    renderConnectionState();
};
window.__test_emitWeight = (scaleData) => {
    // Call the scale data handler directly with a provided scaleData object
    try {
        onScaleData(scaleData);
    } catch (e) {}
};
window.__test_emitPortal = (portalData) => {
    try {
        onPortalData(portalData);
    } catch (e) {}
};
window.__test_recorder = recorder;
window.__test_brewLog = brewLog;
// Seconds before the live TDS estimate appears (30 in the app)
window.__test_setTdsDelay = (seconds) => { tdsMinSeconds = seconds; renderTdsPanel(); };

// Delegate test-only BLE mock installer to the library's installMock
window.__test_installBLEMock = () => {
    try {
        const m = installMock();
        return m;
    } catch (e) {
        // fallback: noop mock
        return { uninstall: () => {}, getWeightCharacteristic: async () => null };
    }
};
// Multi-device mock (scale and/or EC meter), e.g. { devices: ['scale', 'portal'] }
window.__test_installMultiBLEMock = (opts) => installMockBluetooth(opts);

// Optionally, handle ESC key and click outside modal to close
window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('settingsModal');
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Close the top dialog only
        if (brewLogOpen()) brewLogEscape();
        else if (syncOpen()) closeSync();
        else if (calibrationOpen()) closeCalibration();
        else if (finalTdsOpen()) closeFinalTds();
        else if (trimMode && modal.style.display === 'none') cancelTrim();
        else closeSettingsModal();
    });
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeSettingsModal();
    });
    // Settings button only opens modal on explicit click
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSettingsModal();
        });
    }
});

function onScaleDisconnected() {
    log('Scale disconnected');
    lastScaleData = null;
    renderWeightReadout();
    document.getElementById('remainder').textContent = '-- g';
}

// Kept for existing callers: scale disconnect cleanup + UI refresh
function onDisconnected() {
    onScaleDisconnected();
    renderConnectionState();
}

async function disconnect() {
    testConnected.scale = null;
    testConnected.portal = null;
    await devices.disconnectAll();
    renderConnectionState();
}

async function toggleConnect() {
    const btn = document.getElementById('connectToggleBtn');
    const allConnected = deviceConnected('scale') && deviceConnected('portal');
    btn.disabled = true;
    if (!allConnected) {
        btn.textContent = 'Connecting...';
        await connectDevices();
    } else {
        btn.textContent = 'Disconnecting...';
        await disconnect();
    }
    renderConnectionState();
}
