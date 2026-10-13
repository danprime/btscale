// --- Memory Feature: Persistent Storage for Weights ---

const MEMORY_KEY = 'scaleMemoryV1';
let memory = {
  beans: null, // { weight: number }
  carafe: null, // { weight: number }
  portafilter: null // { weight: number }
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
}

function updateMemoryTable() {
  document.getElementById('memoryBeansWeight').textContent = memory.beans?.weight != null ? memory.beans.weight.toFixed(2) : '--';
  document.getElementById('memoryCarafeWeight').textContent = memory.carafe?.weight != null ? memory.carafe.weight.toFixed(2) : '--';
  document.getElementById('memoryPortafilterWeight').textContent = memory.portafilter?.weight != null ? memory.portafilter.weight.toFixed(2) : '--';
}

// Confirmation modal logic
let memoryOverwriteTarget = null;
function openMemoryConfirm(target) {
  memoryOverwriteTarget = target;
  let currentWeight = '--';
  const weightDisplay = document.getElementById('weightDisplay');
  if (weightDisplay) {
    const w = parseFloat(weightDisplay.textContent);
    if (!isNaN(w)) currentWeight = w.toFixed(2) + ' g';
  }
  document.getElementById('memoryConfirmText').textContent = `This will replace the stored weight with ${currentWeight}. Continue?`;
  document.getElementById('memoryConfirmModal').style.display = 'flex';
}
function closeMemoryConfirm() {
  document.getElementById('memoryConfirmModal').style.display = 'none';
  memoryOverwriteTarget = null;
}
function confirmMemoryOverwrite() {
  if (!memoryOverwriteTarget) return;
  const weightDisplay = document.getElementById('weightDisplay');
  let w = weightDisplay ? parseFloat(weightDisplay.textContent) : null;
  if (w != null && !isNaN(w)) {
    memory[memoryOverwriteTarget] = { weight: w };
    saveMemory();
  }
  closeMemoryConfirm();
}

window.openMemoryConfirm = openMemoryConfirm;
window.closeMemoryConfirm = closeMemoryConfirm;

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('memoryConfirmBtn').onclick = confirmMemoryOverwrite;
  loadMemory();
});
// Import utility functions for testability
import { calculateChecksum, verifyChecksum, parseWeightData } from './scale-utils.js';
import { installMock } from './ble-scale.js';
import { installMockBluetooth } from './ble-mock.js';
import { DeviceManager } from './device-manager.js';
import { BrewRecorder } from './brew-recorder.js';

// --- Settings modal logic (moved to top for global availability) ---
function openSettingsModal() {
    document.getElementById('settingsModal').style.display = 'block';
}
function closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
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

    const scaleIcon = document.getElementById('scaleIcon');
    if (scaleIcon) scaleIcon.hidden = !scaleOn;
    const portalIcon = document.getElementById('portalIcon');
    if (portalIcon) portalIcon.hidden = !portalOn;
    const portalInfo = document.getElementById('portalInfo');
    if (portalInfo) portalInfo.style.display = portalOn ? '' : 'none';

    // Scale-only controls
    for (const id of ['tareBtn', 'tareStartBtn', 'tareBeanBtn', 'beepLevel', 'autoOff', 'flowSmoothing', 'targetRatioBtn']) {
        const el = document.getElementById(id);
        if (el) el.disabled = !scaleOn;
    }

    // The timer works with either device (the app keeps its own clock as a fallback).
    const timerBtn = document.getElementById('timerToggleBtn');
    if (timerBtn) timerBtn.disabled = !any;
    if (!any && timerState === 'running') {
        // Everything dropped mid-brew: stop locally and keep what was recorded.
        appTimer.stop();
        recorder.stop();
        timerState = 'reset-required';
        releaseWakeLock();
    }
    renderTimerIcon();
    updateExportButton();
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
        this.interval = setInterval(() => { if (!scaleIsTimeSource()) renderElapsed(this.elapsed()); }, 200);
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
    updateProgressRing(lastScaleData ? lastScaleData.weight : 0, targetWeight, totalSeconds);
}

function updateDisplay(scaleData) {
    lastScaleData = scaleData;
    document.getElementById('weightDisplay').textContent = `${scaleData.weight.toFixed(1)}`;
    document.getElementById('flowRate').textContent = `${scaleData.flowRate.toFixed(1)} g/s`;
    const showRemainder = document.getElementById('showRemainder');
    const remainderPanel = document.getElementById('remainderPanel');
    if (targetWeight !== null && showRemainder && showRemainder.checked) {
        const remainder = targetWeight - scaleData.weight;
        document.getElementById('remainder').textContent = `${remainder >= 0 ? '+' : ''}${remainder.toFixed(1)} g`;
        if (remainderPanel) remainderPanel.style.display = '';
    } else if (remainderPanel) {
        remainderPanel.style.display = 'none';
    }
    // Calculated Ratio in Progress Ring
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
        if (showCurrentRatio.checked && targetWeight && memory.beans?.weight) {
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
    // Elapsed time (also updates the progress ring)
    renderElapsed(scaleIsTimeSource() ? scaleData.milliseconds : appTimer.elapsed());
    const scaleIcon = document.getElementById('scaleIcon');
    if (scaleIcon && scaleData.batteryPercent != null) scaleIcon.title = `Scale connected · battery ${scaleData.batteryPercent}%`;
}

/** EC meter (Belka Portal) readings: temperature and EC cards. */
function updatePortalDisplay(portalData) {
    const tempEl = document.getElementById('tempValue');
    if (tempEl) tempEl.textContent = `${portalData.temp.toFixed(1)} °C`;
    const ecEl = document.getElementById('ecValue');
    if (ecEl) ecEl.textContent = `${portalData.ec.toFixed(2)} mS/cm`;
    const portalIcon = document.getElementById('portalIcon');
    if (portalIcon) portalIcon.title = `EC meter connected · battery ${portalData.battery}%`;
}

function onScaleData(scaleData) {
    recorder.addScale(scaleData);
    updateDisplay(scaleData);
    log(`Weight: ${scaleData.weight.toFixed(2)}g, Flow: ${scaleData.flowRate.toFixed(2)}g/s, Battery: ${scaleData.batteryPercent}%`);
}

function onPortalData(portalData) {
    recorder.addPortal(portalData);
    updatePortalDisplay(portalData);
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
    appTimer.start();
    recorder.start();
    timerState = 'running';
    renderTimerIcon();
    updateExportButton();
    requestWakeLock();
    await sendToDevices('start', targets);
}

async function stopBrew() {
    appTimer.stop();
    recorder.stop();
    timerState = 'reset-required';
    renderTimerIcon();
    updateExportButton();
    releaseWakeLock();
    await sendToDevices('stop', timerTargets());
}

async function resetBrew() {
    appTimer.reset();
    timerState = 'stopped';
    renderTimerIcon();
    renderElapsed(0);
    await sendToDevices('reset', timerTargets());
}

async function triStateTimer() {
    if (!isConnected) {
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
window.addEventListener('DOMContentLoaded', () => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(TIMER_DRIVES_KEY)) || {}; } catch {}
    for (const [id, key] of [['driveScaleTimer', 'scale'], ['drivePortalTimer', 'portal']]) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (typeof saved[key] === 'boolean') el.checked = saved[key];
        el.addEventListener('change', () => {
            const value = { scale: timerDrives('scale'), portal: timerDrives('portal') };
            try { localStorage.setItem(TIMER_DRIVES_KEY, JSON.stringify(value)); } catch {}
        });
    }
    renderConnectionState();
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

// --- Progress Ring Animation and Ratio Slider Overlay ---
const PROGRESS_RING_CIRCUM = 2 * Math.PI * 45; // r=45
const MAX_TIMER_SECONDS = 600; // 10 minutes

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
let currentRatio = 16; // default

function setProgressRing(percent) {
    const fg = document.getElementById('progressRingFg');
    if (fg) {
        const offset = PROGRESS_RING_CIRCUM * (1 - percent);
        fg.setAttribute('stroke-dashoffset', offset);
    }
}

function updateProgressRing(weight, targetWeight, timerSeconds) {
    if (targetWeight && targetWeight > 0) {
        // Show weight progress
        const percent = Math.min(weight / targetWeight, 1);
        setProgressRing(percent);
    } else {
        // Show timer progress (max 10 min)
        const percent = Math.min(timerSeconds / MAX_TIMER_SECONDS, 1);
        setProgressRing(percent);
    }
}

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
        targetWeight = currentWeight * currentRatio;
        const twEl = document.getElementById('targetWeight');
        if (twEl) twEl.textContent = `${targetWeight.toFixed(2)} g`;
        // Store bean weight in memory
        if (!isNaN(currentWeight)) {
            memory.beans = { weight: currentWeight };
            saveMemory();
        }
        await sc.tare();
        log(`Set Beans: ${currentWeight.toFixed(2)}g × ${currentRatio} = ${targetWeight.toFixed(2)}g (scale tared)`);
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
window.exportBrewCsv = exportBrewCsv;

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
        if (e.key === 'Escape') closeSettingsModal();
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
    targetWeight = null;
    document.getElementById('targetWeight').textContent = '-- g';
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
