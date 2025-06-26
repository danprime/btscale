const { calculateChecksum, verifyChecksum, parseWeightData } = require('./scale-utils');

describe('Bookoo Scale Utility Functions', () => {
    test('calculateChecksum returns correct XOR', () => {
        const arr = new Uint8Array([0x03, 0x0B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08]);
        // checksum is XOR of all but last
        let expected = 0;
        for (let i = 0; i < arr.length - 1; i++) expected ^= arr[i];
        expect(calculateChecksum(arr)).toBe(expected);
    });

    test('verifyChecksum returns true for valid data', () => {
        const arr = new Uint8Array([0x03, 0x0B, ...Array(16).fill(0), 0x08]);
        arr[19] = calculateChecksum(arr);
        expect(verifyChecksum(arr)).toBe(true);
    });

    test('verifyChecksum returns false for invalid data', () => {
        const arr = new Uint8Array([0x03, 0x0B, ...Array(16).fill(0), 0x00]);
        arr[19] = 0x00; // wrong checksum
        expect(verifyChecksum(arr)).toBe(false);
    });

    test('parseWeightData returns null for wrong length', () => {
        expect(parseWeightData(new Uint8Array([0x03, 0x0B, 0x00]))).toBeNull();
    });

    test('parseWeightData returns null for bad checksum', () => {
        const arr = new Uint8Array(20);
        arr[0] = 0x03; arr[1] = 0x0B;
        arr[19] = 0x00; // wrong checksum
        expect(parseWeightData(arr)).toBeNull();
    });

    test('parseWeightData parses valid data', () => {
        const arr = new Uint8Array(20);
        arr[0] = 0x03; arr[1] = 0x0B;
        // milliseconds: 0x000001
        arr[4] = 0x01;
        // weight: 12345 (grams*100) = 123.45g, positive
        arr[7] = 0x00; arr[8] = 0x30; arr[9] = 0x39;
        // flow rate: 200 (2.00g/s), positive
        arr[11] = 0x00; arr[12] = 0xC8;
        // battery: 85%
        arr[13] = 85;
        // standby: 0x000A = 10 min
        arr[14] = 0x00; arr[15] = 0x0A;
        // buzzer: 2
        arr[16] = 2;
        // smoothing: 1
        arr[17] = 1;
        // correct checksum
        arr[19] = calculateChecksum(arr);
        const result = parseWeightData(arr);
        expect(result).not.toBeNull();
        expect(result.weight).toBeCloseTo(123.45);
        expect(result.flowRate).toBeCloseTo(2.00);
        expect(result.batteryPercent).toBe(85);
        expect(result.standbyTime).toBe(10);
        expect(result.buzzerGear).toBe(2);
        expect(result.flowSmoothing).toBe(1);
    });
});
