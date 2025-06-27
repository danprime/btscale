// Import utility functions for testability
import { calculateChecksum, verifyChecksum, parseWeightData } from './scale-utils.js';

let bluetoothDevice;
let bluetoothServer;
let commandCharacteristic;
let weightCharacteristic;
let isConnected = false;
let packetCount = 0;
let targetWeight = null;
let timerRunning = false;
let timerLocked = false;

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
    document.getElementById('weightDisplay').textContent = `${scaleData.weight.toFixed(2)} g`;
    document.getElementById('flowRate').textContent = `${scaleData.flowRate.toFixed(2)} g/s`;
    const totalSeconds = scaleData.milliseconds / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds % 1) * 1000);
    document.getElementById('timer').textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    if (targetWeight !== null) {
        const remainder = targetWeight - scaleData.weight;
        document.getElementById('remainder').textContent = `${remainder >= 0 ? '+' : ''}${remainder.toFixed(2)} g`;
    }
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
        } else if (timerState === 'running') {
            // Stop timer
            const command = new Uint8Array([0x03, 0x0A, 0x05, 0x00, 0x00, 0x0D]);
            await commandCharacteristic.writeValue(command);
            log('Stop timer command sent');
            timerState = 'reset-required';
            if (btn) btn.textContent = 'Reset Timer';
        } else if (timerState === 'reset-required') {
            // Reset timer
            const command = new Uint8Array([0x03, 0x0A, 0x06, 0x00, 0x00, 0x0C]);
            await commandCharacteristic.writeValue(command);
            log('Reset timer command sent');
            timerState = 'stopped';
            if (btn) btn.textContent = 'Start Timer';
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

async function setTargetRatio() {
    if (!isConnected) {
        log('Not connected to scale');
        return;
    }
    try {
        // Use the displayed weight as the current weight
        const weightDisplay = document.getElementById('weightDisplay').textContent;
        const currentWeight = parseFloat(weightDisplay.replace(' g', ''));
        const ratio = parseFloat(document.getElementById('ratio').value);
        targetWeight = currentWeight * ratio;
        document.getElementById('targetWeight').textContent = `${targetWeight.toFixed(2)} g`;
        const tareCommand = new Uint8Array([0x03, 0x0A, 0x01, 0x00, 0x00, 0x08]);
        await commandCharacteristic.writeValue(tareCommand);
        log(`Target ratio set: ${currentWeight.toFixed(2)}g × ${ratio} = ${targetWeight.toFixed(2)}g (scale tared)`);
    } catch (error) {
        log(`Error setting target ratio: ${error.message}`);
    }
}

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

if (!navigator.bluetooth) {
    log('Web Bluetooth is not supported in this browser');
    updateStatus('Web Bluetooth not supported');
} else {
    log('Web Bluetooth is supported');
}

// Settings modal logic
function openSettingsModal() {
    document.getElementById('settingsModal').style.display = 'block';
}
function closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
}
function setFlowSymbol(symbol) {
    document.getElementById('flowSymbol').textContent = symbol;
}
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
window.setTargetRatio = setTargetRatio;
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
