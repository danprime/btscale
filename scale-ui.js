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
    if (tareBtn) tareBtn.disabled = !connected;
    const tareStartBtn = document.getElementById('tareStartBtn');
    if (tareStartBtn) tareStartBtn.disabled = !connected;
    const tareBeanBtn = document.getElementById('tareBeanBtn');
    if (tareBeanBtn) {
        tareBeanBtn.disabled = !connected;
        tareBeanBtn.textContent = 'Set Beans';
    }
    const timerBtn = document.getElementById('timerToggleBtn');
    if (timerBtn) {
        timerBtn.disabled = !connected;
        if (!connected) {
            timerState = 'stopped';
            timerBtn.textContent = 'Start Timer';
        } else {
            if (timerState === 'stopped') timerBtn.textContent = 'Start Timer';
            else if (timerState === 'running') timerBtn.textContent = 'Stop Timer';
            else if (timerState === 'reset-required') timerBtn.textContent = 'Reset Timer';
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
    // Current Ratio logic
    const showCurrentRatio = document.getElementById('showCurrentRatio');
    const currentRatioPanel = document.getElementById('currentRatioPanel');
    const currentRatioValue = document.getElementById('currentRatio');
    let ratio = parseFloat(document.getElementById('ratio').value);
    if (showCurrentRatio && currentRatioPanel && currentRatioValue) {
        if (showCurrentRatio.checked && targetWeight && ratio) {
            const beanWeight = targetWeight / ratio;
            if (beanWeight > 0) {
                const currentRatio = scaleData.weight / beanWeight;
                currentRatioValue.textContent = `${currentRatio.toFixed(1)}:1`;
            } else {
                currentRatioValue.textContent = '--';
            }
            currentRatioPanel.style.display = '';
        } else {
            currentRatioValue.textContent = '--';
            currentRatioPanel.style.display = 'none';
        }
    }
    // Update progress ring
    const timerText = document.getElementById('timer').textContent;
    const [min, sec] = timerText.split(':').map(Number);
    const timerSeconds = min * 60 + sec;
    updateProgressRing(scaleData.weight, targetWeight, timerSeconds);
    // Update ratio label
    const ratioLabel = document.getElementById('ratioLabel');
    if (ratioLabel) ratioLabel.textContent = `${currentRatio}:1`;
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
    try {
        if (timerState === 'stopped') {
            // Start timer
            const command = new Uint8Array([0x03, 0x0A, 0x04, 0x00, 0x00, 0x0A]);
            await commandCharacteristic.writeValue(command);
            log('Start timer command sent');
            timerState = 'running';
            if (btn) btn.textContent = 'Stop Timer';
            requestWakeLock();
        } else if (timerState === 'running') {
            // Stop timer
            const command = new Uint8Array([0x03, 0x0A, 0x05, 0x00, 0x00, 0x0D]);
            await commandCharacteristic.writeValue(command);
            log('Stop timer command sent');
            timerState = 'reset-required';
            if (btn) btn.textContent = 'Reset Timer';
            releaseWakeLock();
        } else if (timerState === 'reset-required') {
            // Reset timer
            const command = new Uint8Array([0x03, 0x0A, 0x06, 0x00, 0x00, 0x0C]);
            await commandCharacteristic.writeValue(command);
            log('Reset timer command sent');
            timerState = 'stopped';
            if (btn) btn.textContent = 'Start Timer';
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
function openRatioSlider() {
    const overlay = document.getElementById('ratioSliderOverlay');
    const track = document.getElementById('ratioSliderTrack');
    if (!overlay || !track) return;
    // Clear track
    track.innerHTML = '';
    const ratios = currentBrewMode === 'brew' ? brewRatios : espressoRatios;
    ratios.forEach((r, i) => {
        const btn = document.createElement('button');
        btn.className = 'ratio-slider-option' + (r.ratio === currentRatio ? ' selected' : '');
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('aria-label', `${r.ratio}:1 ${r.label}`);
        btn.textContent = `${r.ratio}:1  (${r.label})`;
        btn.onclick = () => {
            currentRatio = r.ratio;
            document.getElementById('ratioLabel').textContent = `${currentRatio}:1`;
            // Update selection highlight
            Array.from(track.children).forEach(child => child.classList.remove('selected'));
            btn.classList.add('selected');
        };
        btn.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') btn.click();
        };
        track.appendChild(btn);
    });
    overlay.style.display = '';
    // Focus first selected
    setTimeout(() => {
        const sel = track.querySelector('.selected');
        if (sel) sel.focus();
    }, 50);
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
