// Import utility functions for testability
import { calculateChecksum, verifyChecksum, parseWeightData } from './scale-utils.js';

let bluetoothDevice;
let bluetoothServer;
let commandCharacteristic;
let weightCharacteristic;
let isConnected = false;
let packetCount = 0;
let targetWeight = null;

// Service and characteristic UUIDs
const SERVICE_UUID = 0x0FFE;
const COMMAND_CHAR_UUID = 0xFF12;
const WEIGHT_CHAR_UUID = 0xFF11;

function log(message) {
    const logElement = document.getElementById('log');
    const timestamp = new Date().toLocaleTimeString();
    logElement.innerHTML += `[${timestamp}] ${message}<br>`;
    logElement.scrollTop = logElement.scrollHeight;
}

function updateStatus(status, connected = false) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = status;
    statusElement.className = `status ${connected ? 'connected' : 'disconnected'}`;
    document.getElementById('connectBtn').disabled = connected;
    document.getElementById('tareBtn').disabled = !connected;
    document.getElementById('tareStartBtn').disabled = !connected;
    document.getElementById('startTimerBtn').disabled = !connected;
    document.getElementById('stopTimerBtn').disabled = !connected;
    document.getElementById('resetTimerBtn').disabled = !connected;
    document.getElementById('disconnectBtn').disabled = !connected;
    document.getElementById('beepLevel').disabled = !connected;
    document.getElementById('autoOff').disabled = !connected;
    document.getElementById('flowSmoothing').disabled = !connected;
    document.getElementById('targetRatioBtn').disabled = !connected;
    isConnected = connected;
}

function updateDisplay(scaleData) {
    packetCount++;
    document.getElementById('weightDisplay').textContent = `${scaleData.weight.toFixed(2)} g`;
    document.getElementById('weightInfo').textContent = `${scaleData.weight.toFixed(2)} g`;
    document.getElementById('flowRate').textContent = `${scaleData.flowRate.toFixed(2)} g/s`;
    document.getElementById('battery').textContent = `${scaleData.batteryPercent}%`;
    const totalSeconds = scaleData.milliseconds / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds % 1) * 1000);
    document.getElementById('timer').textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    document.getElementById('standbyTime').textContent = `${scaleData.standbyTime} min`;
    document.getElementById('buzzerLevel').textContent = scaleData.buzzerGear.toString();
    document.getElementById('smoothingStatus').textContent = scaleData.flowSmoothing ? 'ON' : 'OFF';
    document.getElementById('weightUnit').textContent = scaleData.weightUnit === 0 ? 'grams' : `unit ${scaleData.weightUnit}`;
    document.getElementById('weightSymbol').textContent = scaleData.weightSymbol === 1 ? '-' : '+';
    document.getElementById('flowSymbol').textContent = scaleData.flowSymbol === 1 ? '-' : '+';
    document.getElementById('rawMilliseconds').textContent = scaleData.milliseconds.toString();
    document.getElementById('packetCount').textContent = packetCount.toString();
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
    } catch (error) {
        log(`Error sending tare and start command: ${error.message}`);
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
        const currentWeightText = document.getElementById('weightInfo').textContent;
        const currentWeight = parseFloat(currentWeightText.replace(' g', ''));
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
    document.getElementById('connectBtn').disabled = true;
} else {
    log('Web Bluetooth is supported');
}

// Attach UI functions to window for HTML onclick compatibility
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
