// based on https://github.com/bpowers/btscale

let SCALE_SERVICE_UUID = '0000fe59-0000-1000-8000-00805f9b34fb';
let SCALE_CHARACTERISTIC_UUID = '8ec90003-f315-4f60-9fb8-838830daea50';
let HEADER1 = 0xef;
let HEADER2 = 0xdd;


var Queue = (function () {

    Queue.prototype.running = false;
    Queue.prototype.queue = [];
    Queue.prototype.callback = null;

    function Queue(callback) {

        this.queue = [];
        this.callback = callback;
    };

    Queue.prototype.add = function (data) {

        var _this = this;

        this.queue.push(data);

        if (!this.running) {
            this.dequeue();
        }
    };

    Queue.prototype.dequeue = function () {

        this.running = true;

        while (val = this.queue.shift()) {
            this.callback(val);
        }

        this.running = false;
    };

    Queue.prototype.next = Queue.prototype.dequeue;

    return Queue;

})();


var Message = (function () {

    function Message(type, payload) {

        this.type = type;
        this.payload = payload;
        this.value = null;

        if (type === 5) {
            var value = ((payload[1] & 0xff) << 8) + (payload[0] & 0xff);
            var unit = payload[4] & 0xFF;

            if (unit === 1) {
                value /= 10;
            }
            else if (unit === 2) {
                value /= 100;
            }
            else if (unit === 3) {
                value /= 1000;
            }
            else if (unit === 4) {
                value /= 10000;
            }

            if ((payload[5] & 0x02) === 0x02) {
                value *= -1;
            }

            this.value = value;
        }
    }

    return Message;
}());


function encode(msgType, payload) {

    var buf = new ArrayBuffer(5 + payload.length);
    var bytes = new Uint8Array(buf);
    bytes[0] = HEADER1;
    bytes[1] = HEADER2;
    bytes[2] = msgType;
    var cksum1 = 0;
    var cksum2 = 0;

    for (var i = 0; i < payload.length; i++) {
    	var val = payload[i] & 0xff;
    	bytes[3+i] = val;
    	if (i % 2 == 0) {
    		cksum1 += val;
    	}
    	else {
    		cksum2 += val;
    	}
    }

    bytes[payload.length + 3] = (cksum1 & 0xFF);
    bytes[payload.length + 4] = (cksum2 & 0xFF);

    return buf;
}


function decode(bytes) {

	if (bytes[0] !== HEADER1 && bytes[1] !== HEADER2) {
		return;
	}

	var cmd = bytes[2];

    // only supports event notification messages
    if (cmd != 12) {

		//non event notification message
		//scale.js:127 Uint8Array(14) [239, 221, 8, 9, 83, 2, 2, 1, 0, 1, 1, 1, 14, 86]
		// 8 -> status
		// 9 -> length
		// 83 -> battery (83%)
	    console.log('non event notification message');
	    console.log(bytes);
    	return;
    }

    // TODO: verify length + checksum

    var msgType = bytes[4];
    var payloadIn = new Uint8Array(bytes.slice(5));

    return new Message(msgType, payloadIn);
}


function encodeEventData(payload) {

    var buf = new ArrayBuffer(payload.length + 1);
    var bytes = new Uint8Array(buf);
    bytes[0] = payload.length + 1;

    for (var i = 0; i < payload.length; i++) {
    	bytes[i+1] = payload[i] & 0xff;
    }

    return encode(12, bytes);
}


function encodeNotificationRequest() {

    var payload = [
    	0,  // weight
    	1,  // weight argument
    	1,  // battery
    	2,  // battery argument
    	2,  // timer
    	5,  // timer argument
    	3,  // key
    	4   // setting
    ];

    return encodeEventData(payload);
}


function encodeId() {

    var payload = [0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d,0x2d];
    return encode(11, payload);
}


function encodeHeartbeat() {

    var payload = [2,0];
    return encode(0, payload);
}



function encodeTare() {

    var payload = [0];
    return encode(4, payload);
}


var Scale = (function () {

    function Scale(device) {

        this.connected = false;
        this.service = null;
        this.characteristic = null;
        this.weight = null;
        this.device = device;
        this.name = this.device.name;
        this.queue = null;
        console.log('created scale for ' + this.device.address + ' (' + this.device.name + ')');
        this.connect();
    }

    Scale.prototype.connect = function () {
        var _this = this;
        if (this.connected) {
            console.log('Already connected.');
            return;
        }
        var log = console.log.bind(console);
        _this.queue = new Queue(function(payload) {
            _this.addBuffer(payload);
            if (_this.packet.byteLength <= 3) {
                return;
            }
            var msg = decode(_this.packet);
            _this.packet = null;
            if (!msg) {
                console.log('characteristic value update, but no message');
                return;
            }
            if (msg.type === 5) {
                _this.weight = msg.value;
                console.log('weight: ' + msg.value);
            } else {
                console.log('non-weight response');
                console.log(msg);
            }
        });
        console.log('Attempting to connect to device:', this.device);
        this.device.gatt.connect()
            .then(function(server) {
                console.log('GATT server connected:', server);
                return server.getPrimaryServices();
            }, function(err) {
                console.log('Error connecting to GATT server:', err);
                throw err;
            })
            .then(function(services) {
                console.log('Discovered services:', services.map(s => s.uuid));
                services.forEach(function(service) {
                    console.log('Service UUID:', service.uuid);
                    service.getCharacteristics().then(function(characteristics) {
                        console.log('Discovered characteristics for service', service.uuid, ':', characteristics.map(c => c.uuid));
                        characteristics.forEach(function(characteristic) {
                            console.log('Characteristic UUID:', characteristic.uuid, 'Properties:', characteristic.properties);
                            // Subscribe to indications first, then write ident after subscription
                            if (characteristic.properties.indicate) {
                                characteristic.startNotifications().then(function() {
                                    console.log('Subscribed to indications for', characteristic.uuid);
                                    characteristic.addEventListener('characteristicvaluechanged', function(event) {
                                        var raw = new Uint8Array(event.target.value.buffer);
                                        console.log('Indication from characteristic', characteristic.uuid, ':', raw);
                                    });
                                    // After subscribing, write ident (only one write)
                                    if (characteristic.properties.write) {
                                        characteristic.writeValue(encodeId()).then(function() {
                                            console.log('Wrote ident to characteristic', characteristic.uuid);
                                        }).catch(function(err) {
                                            console.log('Error writing ident to', characteristic.uuid, ':', err);
                                        });
                                    }
                                }).catch(function(err) {
                                    console.log('Characteristic', characteristic.uuid, 'does not support indications:', err);
                                });
                            }
                            // REMOVE: Do not write notification request or test byte
                        });
                    }).catch(function(err) {
                        console.log('Error getting characteristics for service', service.uuid, ':', err);
                    });
                });
            })
            .catch(function(err) {
                console.log('Error during connection/discovery:', err);
            });
    };


	Scale.prototype.addBuffer = function(buffer2) {

		var tmp = new Uint8Array(buffer2);
		var len = 0;

		if (this.packet != null) {
			len = this.packet.length;
		}

		var result = new Uint8Array(len + buffer2.byteLength);

		for (var i = 0; i < len; i++) {
			result[i] = this.packet[i];
		}

		for (var i = 0; i < buffer2.byteLength; i++) {
			result[i+len] = tmp[i];
		}

	  	this.packet = result;
	}


    Scale.prototype.characteristicValueChanged = function (event) {
        var raw = new Uint8Array(event.target.value.buffer);
        // Log raw bytes to the console for debugging
        console.log('Notification received, raw bytes:', raw);
        // Add to queue for normal decode logic
        this.queue.add(event.target.value.buffer);
        // UI will be updated by the queue callback if weight is decoded
    };

    Scale.prototype.disconnect = function () {

        this.connected = false;
        if (this.device) {
            this.device.gatt.connect();
        }
    };

    Scale.prototype.notificationsReady = function () {

        console.log('scale ready');
        this.connected = true;
        this.ident();
        setInterval(this.heartbeat.bind(this), 5000);
        //setInterval(this.tare.bind(this), 5000);
    };

    Scale.prototype.ident = function () {

        if (!this.connected) {
            return false;
        }

        var _this = this;
        this.characteristic.writeValue(encodeId())
        .then(function () {
        }, function (err) {
            console.log('write ident failed: ' + err);
        }).then(function() {
            _this.characteristic.writeValue(encodeNotificationRequest())
            .then(function () {
            }, function (err) {
                console.log('write failed: ' + err);
            });
        });

        return true;
    };

    Scale.prototype.heartbeat = function () {

        if (!this.connected) {
            return false;
        }

        this.characteristic.writeValue(encodeHeartbeat())
        .then(function () {
        }, function (err) {
            console.log('write heartbeat failed: ' + err);
        });

        return true;
    };

    Scale.prototype.tare = function () {

        if (!this.connected) {
            return false;
        }

        this.characteristic.writeValue(encodeTare())
        .then(function () {
        }, function (err) {
            console.log('write tare failed: ' + err);
        });

        return true;
    };

    return Scale;
}());


var bluetooth = navigator.bluetooth;
var ScaleFinder = (function () {

    function ScaleFinder() {
        this.ready = false;
        this.devices = {};
        this.scales = [];
        this.failed = false;
        console.log('new ScaleFinder');
    }

    ScaleFinder.prototype.deviceAdded = function (device) {

        if (device.address in this.devices) {
            console.log('WARN: device added that is already known ' + device.address);
            return;
        }

        var scale = new Scale(device);
        this.devices[device.address] = scale;
        this.scales.push(scale);
    };

    ScaleFinder.prototype.startDiscovery = function () {
        var _this = this;
        if (this.failed) {
            return;
        }
        console.log('%cSelect your scale from the list. After connecting, check the console for service and characteristic UUIDs. Copy them and update SCALE_SERVICE_UUID and SCALE_CHARACTERISTIC_UUID at the top of scale.js.', 'color: green; font-size: 1.2em');
        bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [SCALE_SERVICE_UUID] // Add the custom service UUID here
        })
        .then(function(device) {
            console.log('Selected device:', device);
            return device.gatt.connect();
        })
        .then(function(server) {
            return server.getPrimaryServices();
        })
        .then(function(services) {
            services.forEach(service => {
                console.log('%cService UUID: ' + service.uuid, 'color: blue; font-weight: bold');
                service.getCharacteristics().then(characteristics => {
                    characteristics.forEach(characteristic => {
                        console.log('%cCharacteristic UUID: ' + characteristic.uuid, 'color: purple');
                    });
                });
            });
            console.log('%cCopy the relevant UUIDs above and update your code.', 'color: orange; font-size: 1.1em');
        });
    };

    ScaleFinder.prototype.stopDiscovery = function () {

        if (this.failed) {
            return;
        }
    };

    return ScaleFinder;
}());

if (typeof window !== 'undefined') {
    window.ScaleFinder = ScaleFinder;

    document.addEventListener('DOMContentLoaded', function() {
        // Create a button
        var btn = document.createElement('button');
        btn.textContent = 'Find Bluetooth Scale';
        btn.style.fontSize = '1.2em';
        btn.style.margin = '1em';
        document.body.appendChild(btn);

        // Create a div to display weight
        var weightDiv = document.createElement('div');
        weightDiv.id = 'weight-display';
        weightDiv.style.fontSize = '2em';
        weightDiv.style.margin = '1em';
        weightDiv.textContent = 'Weight: --';
        document.body.appendChild(weightDiv);

        // Create a div to display device info
        var infoDiv = document.createElement('div');
        infoDiv.id = 'device-info';
        infoDiv.style.fontSize = '1em';
        infoDiv.style.margin = '1em';
        infoDiv.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(infoDiv);

        var finder = null;
        var lastScale = null;
        btn.addEventListener('click', function() {
            // Disconnect previous scale if connected
            if (lastScale && lastScale.device && lastScale.device.gatt && lastScale.device.gatt.connected) {
                console.log('Disconnecting previous scale...');
                lastScale.device.gatt.disconnect();
            }
            finder = new ScaleFinder();
            // Patch all scales to update the display
            var origDeviceAdded = finder.deviceAdded.bind(finder);
            finder.deviceAdded = function(device) {
                origDeviceAdded(device);
                var scale = finder.scales[finder.scales.length - 1];
                lastScale = scale;
                // Patch the scale to update the display on new weight
                var origQueueCallback = scale.queue.callback;
                scale.queue.callback = function(payload) {
                    origQueueCallback.call(scale.queue, payload);
                    if (scale.weight !== null) {
                        weightDiv.textContent = 'Weight: ' + scale.weight + ' g';
                    }
                };
            };
            // Override startDiscovery to show device/services/characteristics on page
            finder.startDiscovery = function() {
                console.log('startDiscovery called');
                infoDiv.textContent = 'Searching for Bluetooth devices...';
                var _this = this;
                if (this.failed) {
                    console.log('Discovery failed flag set');
                    return;
                }
                navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [SCALE_SERVICE_UUID]
                })
                .then(function(device) {
                    console.log('Device selected:', device);
                    infoDiv.textContent = 'Selected device:\n' +
                        'Name: ' + (device.name || '(no name)') + '\n' +
                        'Id: ' + device.id + '\n';
                    return device.gatt.connect().then(function(server) {
                        console.log('GATT connect success');
                        return server.getPrimaryServices();
                    }).then(function(services) {
                        let info = infoDiv.textContent + '\nServices:';
                        let servicePromises = services.map(function(service) {
                            info += '\n  Service UUID: ' + service.uuid;
                            return service.getCharacteristics().then(function(characteristics) {
                                characteristics.forEach(function(characteristic) {
                                    info += '\n    Characteristic UUID: ' + characteristic.uuid;
                                });
                            });
                        });
                        Promise.all(servicePromises).then(function() {
                            infoDiv.textContent = info + '\n\nCopy the relevant UUIDs above and update your code.';
                            console.log('Calling deviceAdded');
                            _this.deviceAdded(device);
                        });
                    });
                })
                .catch(function(err) {
                    console.log('Error in startDiscovery:', err);
                    infoDiv.textContent = 'Error: ' + err;
                });
            };
            finder.startDiscovery();
        });
    });
}