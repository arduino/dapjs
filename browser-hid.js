'use strict';

var EE = require('events').EventEmitter;
var util = require('util')

// Check that hid was initialized.
if (!chrome.hid) {
  throw new Error('Could not initialize hid. Check your app manifest permissions.');
}

function toBuffer(ab) {
  var buffer = new Buffer(ab.byteLength);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buffer.length; ++i) {
      buffer[i] = view[i];
  }
  return buffer;
}

function toArrayBuffer(buffer) {
  var ab = new ArrayBuffer(buffer.length);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buffer.length; ++i) {
      view[i] = buffer[i];
  }
  return ab;
}

function HID(path) {
  EE.call(this);

  this.path = path;
  this.connectionId = null;
  this.paused = true;
  this.closed = true;

  var self = this;
  self.on('newListener', function(eventName, listener) {
    if (eventName === 'data') {
        process.nextTick(self.resume.bind(self));
    }
  });
}

util.inherits(HID, EE);

HID.prototype.open = function(callback) {
  var self = this;
  chrome.hid.connect(this.path, function(connection) {
    self.connectionId = connection.connectionId;
    self.closed = false;

    callback(chrome.runtime.lastError);

    self.resume();
  });
};

HID.prototype.close = function(callback) {
  var self = this;

  self._closing = true;

  chrome.hid.disconnect(this.connectionId, function() {
    self.connectionId = null;
    self.closed = true;

    callback(chrome.runtime.lastError);
  });
};

HID.prototype.write = function(data, callback) {
  var reportId = data[0];
  var data = toArrayBuffer(data.slice(1));
  callback = callback || function() {};

  chrome.hid.send(this.connectionId, reportId, data, callback);
};

HID.prototype.read = function(callback) {
  chrome.hid.receive(this.connectionId, function(reportId, data) {
    if (chrome.runtime.lastError) {
      return callback(chrome.runtime.lastError);
    }

    var buffer = toBuffer(data);

    return callback(chrome.runtime.lastError, buffer);
  });
};

HID.prototype.resume = function() {
  var self = this;

  if (!self.closed && self.paused && self.listeners('data').length > 0) {
    self.paused = false;

    self.read(function readFunc(err, data) {
      if (err) {
        if (self._closing) {
          self._closing = false;
        } else {
          self.emit('error', err);
        }
      } else {
        self.paused = self.paused || (self.listeners('data').length === 0);

        if (!self.paused) {
          self.read(readFunc);
        }

        self.emit('data', data);
      }
    });
  }
};

HID.prototype.pause = function() {
  this.paused = true;
};

HID.prototype.getDeviceInfo = function() {
  return pathToHidDeviceInfo[this.path];
};

var pathToHidDeviceInfo = {};

var getDevices = function(callback) {
  chrome.hid.getDevices({}, function(devices) {
    if (chrome.runtime.lastError) {
      return callback(chrome.runtime.lastError);
    }

    var hidInfos = [];

    devices.forEach(function(device) {
      var hidInfo = {
        path: device.deviceId,
        vendorId: device.vendorId,
        productId: device.productId,
        product: device.productName,
        serialNumber: device.serialNumber,
        usagePage: device.collections[0].usagePage,
        usage: device.collections[0].usage,
        
      };

      pathToHidDeviceInfo[hidInfo.path] = hidInfo;

      hidInfos.push(hidInfo);
    });

    callback(null, hidInfos);
  });
};

module.exports = {
  HID: HID,
  devices: getDevices
};
