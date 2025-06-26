// CommonJS version for Jest/Node
function calculateChecksum(data) {
    let checksum = 0;
    for (let i = 0; i < data.length - 1; i++) {
        checksum ^= data[i];
    }
    return checksum;
}

function verifyChecksum(data) {
    const calculatedChecksum = calculateChecksum(data);
    const receivedChecksum = data[data.length - 1];
    return calculatedChecksum === receivedChecksum;
}

function parseWeightData(data) {
    if (data.length !== 20) {
        return null;
    }
    if (!verifyChecksum(data)) {
        return null;
    }
    const productNumber = data[0];
    const type = data[1];
    if (productNumber !== 0x03 || type !== 0x0B) {
        return null;
    }
    const milliseconds = (data[2] << 16) | (data[3] << 8) | data[4];
    const weightUnit = data[5];
    const weightSymbol = data[6];
    const rawWeight = (data[7] << 16) | (data[8] << 8) | data[9];
    const weight = (weightSymbol === 1 ? -rawWeight : rawWeight) / 100.0;
    const flowSymbol = data[10];
    const rawFlowRate = (data[11] << 8) | data[12];
    const flowRate = (flowSymbol === 1 ? -rawFlowRate : rawFlowRate) / 100.0;
    const batteryPercent = data[13];
    const standbyTime = (data[14] << 8) | data[15];
    const buzzerGear = data[16];
    const flowSmoothing = data[17];
    return {
        milliseconds,
        weight,
        flowRate,
        batteryPercent,
        standbyTime,
        buzzerGear,
        flowSmoothing,
        weightUnit,
        weightSymbol,
        flowSymbol
    };
}

module.exports = {
    calculateChecksum,
    verifyChecksum,
    parseWeightData
};
