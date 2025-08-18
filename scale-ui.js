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

let bluetoothDevice;
let bluetoothServer;
let commandCharacteristic;
let weightCharacteristic;
let isConnected = false;
let packetCount = 0;
let targetWeight = null;
let timerRunning = false;
let timerLocked = false;
let timerState = 'stopped'; // Global timerState declaration

// Service and characteristic UUIDs
const SERVICE_UUID = 0x0FFE;
const COMMAND_CHAR_UUID = 0xFF12;
const WEIGHT_CHAR_UUID = 0xFF11;

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

function updateStatus(status, connected = false) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.className = `status ${connected ? 'connected' : 'disconnected'}`;
    }
    const connectBtn = document.getElementById('connectToggleBtn');
    if (connectBtn) {
        connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
        connectBtn.disabled = false;
    }
    const tareBtn = document.getElementById('tareBtn');
    if (tareBtn) {
        tareBtn.disabled = !connected;
        tareBtn.textContent = 'T';
    }
    const tareStartBtn = document.getElementById('tareStartBtn');
    if (tareStartBtn) tareStartBtn.disabled = !connected;
    const tareBeanBtn = document.getElementById('tareBeanBtn');
    if (tareBeanBtn) {
        tareBeanBtn.disabled = !connected;
        tareBeanBtn.innerHTML = `<?xml version="1.0" encoding="utf-8"?>
        <svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="68" height="54" viewBox="0 0 122.88 96.84" style="enable-background:new 0 0 122.88 96.84; display:block; margin:auto;" xml:space="preserve">
        <style type="text/css">.st0{fill-rule:evenodd;clip-rule:evenodd;fill:#5E361C;}</style>
        <g><path class="st0" d="M31.96,0c14.08,0,26.03,12.61,30.29,30.11c-1.07,0.94-2.12,1.92-3.15,2.95c-9.36,9.36-15.11,20.63-16.82,31.26 c-1.2,7.41-0.44,14.53,2.38,20.54c-2.72,1.63-5.64,2.76-8.69,3.29c5.92-23.37,3.06-34.99-1.37-45.75 c-4.29-10.42-10.11-21.59-3.54-42.39C31.35,0.01,31.66,0,31.96,0L31.96,0z M115.57,26.95c12.48,12.48,8.59,36.61-8.69,53.89 c-15.95,15.95-37.73,20.49-50.8,11.29c20.71-12.34,26.9-22.58,31.38-33.32c4.33-10.4,8.12-22.42,27.47-32.47 C115.14,26.53,115.36,26.74,115.57,26.95L115.57,26.95z M53.98,90.46c-0.34-0.3-0.67-0.61-0.99-0.93 c-12.48-12.48-8.59-36.61,8.69-53.89c16.28-16.28,38.63-20.67,51.6-10.7C92.53,35.42,86.92,44.22,82.36,55.17 C78.08,65.43,73.45,78.58,53.98,90.46L53.98,90.46z M33.31,88.46c-0.45,0.03-0.9,0.04-1.35,0.04C14.31,88.5,0,68.69,0,44.25 C0,21.23,12.7,2.31,28.93,0.2c-7.27,22.08-5.01,32.27-0.5,43.23C32.66,53.72,38.68,66.29,33.31,88.46L33.31,88.46z"/></g>
        </svg>`;
    }
    const timerBtn = document.getElementById('timerToggleBtn');
    const timerIcon = document.getElementById('timerBtnIcon');
    if (timerBtn) {
        timerBtn.disabled = !connected;
        if (!connected) {
            timerState = 'stopped';
            if (timerIcon) timerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-8 h-8 text-white ml-1"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;
        } else {
            if (timerState === 'stopped' && timerIcon) timerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-8 h-8 text-white ml-1"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;
            else if (timerState === 'running' && timerIcon) timerIcon.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square w-8 h-8 text-white"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
            else if (timerState === 'reset-required' && timerIcon) timerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rotate-ccw w-6 h-6 text-amber-700"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`;
        }
    }
    const beepLevel = document.getElementById('beepLevel');
    if (beepLevel) beepLevel.disabled = !connected;
    const autoOff = document.getElementById('autoOff');
    if (autoOff) autoOff.disabled = !connected;
    const flowSmoothing = document.getElementById('flowSmoothing');
    if (flowSmoothing) flowSmoothing.disabled = !connected;
    const targetRatioBtn = document.getElementById('targetRatioBtn');
    if (targetRatioBtn) targetRatioBtn.disabled = !connected;
    isConnected = connected;
}

function updateDisplay(scaleData) {
    document.getElementById('weightDisplay').textContent = `${scaleData.weight.toFixed(1)}`;
    document.getElementById('flowRate').textContent = `${scaleData.flowRate.toFixed(2)} g/s`;
    const totalSeconds = Math.floor(scaleData.milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    document.getElementById('timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
    // Update progress ring
    const timerText = document.getElementById('timer').textContent;
    const [min, sec] = timerText.split(':').map(Number);
    const timerSeconds = min * 60 + sec;
    updateProgressRing(scaleData.weight, targetWeight, timerSeconds);
}

function handleWeightData(event) {
    const data = new Uint8Array(event.target.value.buffer);
    log(`Received data: ${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    const scaleData = parseWeightData(data);
    if (scaleData) {
        updateDisplay(scaleData);
        log(`Weight: ${scaleData.weight.toFixed(2)}g, Flow: ${scaleData.flowRate.toFixed(2)}g/s, Battery: ${scaleData.batteryPercent}%`);
    }
}

async function connectToScale() {
    try {
        log('Requesting Bluetooth device...');
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }]
        });
        log(`Connected to device: ${bluetoothDevice.name}`);
        updateStatus(`Connected to ${bluetoothDevice.name}`, true);
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        log('Connecting to GATT server...');
        bluetoothServer = await bluetoothDevice.gatt.connect();
        log('Getting service...');
        const service = await bluetoothServer.getPrimaryService(SERVICE_UUID);
        log('Getting characteristics...');
        commandCharacteristic = await service.getCharacteristic(COMMAND_CHAR_UUID);
        weightCharacteristic = await service.getCharacteristic(WEIGHT_CHAR_UUID);
        log('Starting notifications...');
        await weightCharacteristic.startNotifications();
        weightCharacteristic.addEventListener('characteristicvaluechanged', handleWeightData);
        log('Successfully connected and subscribed to weight notifications!');
    } catch (error) {
        log(`Connection error: ${error.message}`);
        updateStatus(`Error: ${error.message}`);
    }
}

async function sendTareCommand() {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const tareCommand = new Uint8Array([0x03, 0x0A, 0x01, 0x00, 0x00, 0x08]);
        await commandCharacteristic.writeValue(tareCommand);
        log('Tare command sent');
    } catch (error) {
        log(`Error sending tare command: ${error.message}`);
    }
}

async function sendTareAndStartCommand() {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const command = new Uint8Array([0x03, 0x0A, 0x07, 0x00, 0x00, 0x00]);
        await commandCharacteristic.writeValue(command);
        log('Tare and start timer command sent');
        timerState = 'running';
        const toggleBtn = document.getElementById('timerToggleBtn');
        if (toggleBtn) toggleBtn.textContent = 'Stop Timer';
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

// Patch triStateTimer to manage wake lock
async function triStateTimer() {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    const btn = document.getElementById('timerToggleBtn');
    const timerIcon = document.getElementById('timerBtnIcon');
    try {
        if (timerState === 'stopped') {
            // Start timer
            const command = new Uint8Array([0x03, 0x0A, 0x04, 0x00, 0x00, 0x0A]);
            await commandCharacteristic.writeValue(command);
            log('Start timer command sent');
            timerState = 'running';
            if (timerIcon) timerIcon.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square w-8 h-8 text-white"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
            requestWakeLock();
        } else if (timerState === 'running') {
            // Stop timer
            const command = new Uint8Array([0x03, 0x0A, 0x05, 0x00, 0x00, 0x0D]);
            await commandCharacteristic.writeValue(command);
            log('Stop timer command sent');
            timerState = 'reset-required';
            if (timerIcon) timerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rotate-ccw w-6 h-6 text-amber-700"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`;
            releaseWakeLock();
        } else if (timerState === 'reset-required') {
            // Reset timer
            const command = new Uint8Array([0x03, 0x0A, 0x06, 0x00, 0x00, 0x0C]);
            await commandCharacteristic.writeValue(command);
            log('Reset timer command sent');
            timerState = 'stopped';
            if (timerIcon) timerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-8 h-8 text-white ml-1"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;
            releaseWakeLock();
        }
    } catch (error) {
        log(`Error in timer button: ${error.message}`);
    }
}

async function sendStartTimerCommand() {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const command = new Uint8Array([0x03, 0x0A, 0x04, 0x00, 0x00, 0x0A]);
        await commandCharacteristic.writeValue(command);
        log('Start timer command sent');
    } catch (error) {
        log(`Error sending start timer command: ${error.message}`);
    }
}

async function sendStopTimerCommand() {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const command = new Uint8Array([0x03, 0x0A, 0x05, 0x00, 0x00, 0x0D]);
        await commandCharacteristic.writeValue(command);
        log('Stop timer command sent');
    } catch (error) {
        log(`Error sending stop timer command: ${error.message}`);
    }
}

async function sendResetTimerCommand() {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const command = new Uint8Array([0x03, 0x0A, 0x06, 0x00, 0x00, 0x0C]);
        await commandCharacteristic.writeValue(command);
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
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const levelByte = parseInt(level);
        const checksum = 0x03 ^ 0x0A ^ 0x02 ^ levelByte ^ 0x00;
        const command = new Uint8Array([0x03, 0x0A, 0x02, levelByte, 0x00, checksum]);
        await commandCharacteristic.writeValue(command);
        document.getElementById('beepValue').textContent = level;
        log(`Beep level set to ${level}`);
    } catch (error) {
        log(`Error setting beep level: ${error.message}`);
    }
}

async function setAutoOff(minutes) {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const minutesByte = parseInt(minutes);
        const checksum = 0x03 ^ 0x0A ^ 0x03 ^ minutesByte ^ 0x00;
        const command = new Uint8Array([0x03, 0x0A, 0x03, minutesByte, 0x00, checksum]);
        await commandCharacteristic.writeValue(command);
        document.getElementById('autoOffValue').textContent = minutes;
        log(`Auto-off set to ${minutes} minutes`);
    } catch (error) {
        log(`Error setting auto-off: ${error.message}`);
    }
}

async function setFlowSmoothing(enabled) {
    if (!isConnected || !commandCharacteristic) {
        log('Not connected to scale');
        return;
    }
    try {
        const enabledByte = enabled ? 0x01 : 0x00;
        const checksum = 0x03 ^ 0x0A ^ 0x08 ^ enabledByte ^ 0x00;
        const command = new Uint8Array([0x03, 0x0A, 0x08, enabledByte, 0x00, checksum]);
        await commandCharacteristic.writeValue(command);
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
    if (!isConnected) {
        log('Not connected to scale');
        return;
    }
    try {
        // Use the displayed weight as the current weight
        const weightDisplay = document.getElementById('weightDisplay');
        const currentWeight = weightDisplay ? parseFloat(weightDisplay.textContent) : 0;
        targetWeight = currentWeight * currentRatio;
        document.getElementById('targetWeight').textContent = `${targetWeight.toFixed(2)} g`;
        // Store bean weight in memory
        if (!isNaN(currentWeight)) {
            memory.beans = { weight: currentWeight };
            saveMemory();
        }
        const tareCommand = new Uint8Array([0x03, 0x0A, 0x01, 0x00, 0x00, 0x08]);
        await commandCharacteristic.writeValue(tareCommand);
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
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.setFlowSymbol = setFlowSymbol;
window.connectToScale = connectToScale;
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

// Optionally, handle ESC key and click outside modal to close
window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('settingsModal');
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSettingsModal();
    });
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeSettingsModal();
    });
});

function onDisconnected() {
    log('Device disconnected');
    updateStatus('Disconnected');
    bluetoothDevice = null;
    bluetoothServer = null;
    commandCharacteristic = null;
    weightCharacteristic = null;
    targetWeight = null;
    document.getElementById('targetWeight').textContent = '-- g';
    document.getElementById('remainder').textContent = '-- g';
}

async function disconnect() {
    if (bluetoothServer) {
        bluetoothServer.disconnect();
    }
}

async function toggleConnect() {
    const btn = document.getElementById('connectToggleBtn');
    if (!isConnected) {
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        await connectToScale();
        btn.disabled = false;
        btn.textContent = 'Disconnect';
    } else {
        btn.disabled = true;
        btn.textContent = 'Disconnecting...';
        await disconnect();
        btn.disabled = false;
        btn.textContent = 'Connect';
    }
}
