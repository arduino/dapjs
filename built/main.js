/// <reference path="../typings/index.d.ts" />
"use strict";
var Promise = require("bluebird");
var STACK_BASE = 0x20004000;
var PAGE_SIZE = 0x400;
function readUInt32LE(b, idx) {
    return (b[idx] |
        (b[idx + 1] << 8) |
        (b[idx + 2] << 16) |
        (b[idx + 3] << 24)) >>> 0;
}
function bufferConcat(bufs) {
    var len = 0;
    for (var _i = 0, bufs_1 = bufs; _i < bufs_1.length; _i++) {
        var b = bufs_1[_i];
        len += b.length;
    }
    var r = new Uint8Array(len);
    len = 0;
    for (var _a = 0, bufs_2 = bufs; _a < bufs_2.length; _a++) {
        var b = bufs_2[_a];
        r.set(b, len);
        len += b.length;
    }
    return r;
}
function apReg(r, mode) {
    var v = r | mode | 1 /* AP_ACC */;
    return (4 + ((v & 0x0c) >> 2));
}
function bank(addr) {
    var APBANKSEL = 0x000000f0;
    return (addr & APBANKSEL) | (addr & 0xff000000);
}
var HID = require('node-hid');
function error(msg, reconnect, wait) {
    if (reconnect === void 0) { reconnect = false; }
    if (wait === void 0) { wait = false; }
    var err = new Error(msg);
    if (reconnect)
        err.dapReconnect = true;
    if (wait)
        err.dapWait = true;
    throw err;
}
function info(msg) {
    // console.log(msg)
}
function addInt32(arr, val) {
    if (!arr)
        arr = [];
    arr.push(val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >> 24) & 0xff);
    return arr;
}
function hex(v) {
    return "0x" + v.toString(16);
}
function rid(v) {
    var m = [
        "DP_0x0",
        "DP_0x4",
        "DP_0x8",
        "DP_0xC",
        "AP_0x0",
        "AP_0x4",
        "AP_0x8",
        "AP_0xC",
    ];
    return m[v] || "?";
}
var Dap = (function () {
    function Dap(path) {
        var _this = this;
        this.sent = [];
        this.waiting = [];
        this.maxSent = 1;
        this.packetLength = 64;
        this.dev = new HID.HID(path, {
            autoOpen: false
        });
        this.dev.on("data", function (buf) {
            var c = _this.sent.shift();
            if (!c) {
                console.log("DROP", buf);
            }
            else {
                //console.log("GOT", buf)
                c.resolve(buf);
                _this.pokeWaiting();
            }
        });
        this.dev.on("error", function (err) {
            console.log(err.message);
        });
    }
    Dap.prototype.pokeWaiting = function () {
        if (this.sent.length < this.maxSent && this.waiting.length > 0) {
            var w = this.waiting.shift();
            this.sent.push(w);
            //console.log(`SEND ${this.waiting.length} -> ${this.sent.length} ${w.data.join(",")}`)
            this.sendNums(w.data);
        }
    };
    Dap.prototype.sendNums = function (lst) {
        lst.unshift(0);
        while (lst.length < this.packetLength)
            lst.push(0);
        this.dev.write(lst);
    };
    Dap.prototype.jtagToSwdAsync = function () {
        var _this = this;
        var arrs = [
            [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
            [0x9e, 0xe7],
            [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
            [0x00]
        ];
        return promiseIterAsync(arrs, function (a) { return _this.swjSequenceAsync(a); });
    };
    Dap.prototype.swjSequenceAsync = function (data) {
        data.unshift(data.length * 8);
        return this.cmdNumsAsync(18 /* DAP_SWJ_SEQUENCE */, data).then(function () { });
    };
    Dap.prototype.cmdNumsAsync = function (op, data) {
        var _this = this;
        data.unshift(op);
        return new Promise(function (resolve, reject) {
            _this.waiting.push({ resolve: resolve, data: data });
            _this.pokeWaiting();
        }).then(function (buf) {
            if (buf[0] != op)
                error("Bad response for " + op + " -> " + buf[0]);
            switch (op) {
                case 2 /* DAP_CONNECT */:
                case 0 /* DAP_INFO */:
                case 5 /* DAP_TRANSFER */:
                    break;
                default:
                    if (buf[1] != 0)
                        error("Bad status for " + op + " -> " + buf[1]);
            }
            return buf;
        });
    };
    Dap.prototype.infoAsync = function (id) {
        return this.cmdNumsAsync(0 /* DAP_INFO */, [id])
            .then(function (buf) {
            if (buf[1] == 0)
                return null;
            switch (id) {
                case 240 /* CAPABILITIES */:
                case 254 /* PACKET_COUNT */:
                case 255 /* PACKET_SIZE */:
                    if (buf[1] == 1)
                        return buf[2];
                    if (buf[1] == 2)
                        return buf[3] << 8 | buf[2];
            }
            return buf.slice(2, buf[1] + 2 - 1); // .toString("utf8")
        });
    };
    Dap.prototype.resetTargetAsync = function () {
        return this.cmdNumsAsync(10 /* DAP_RESET_TARGET */, []);
    };
    Dap.prototype.disconnectAsync = function () {
        var devClose = Promise.promisify(this.dev.close.bind(this.dev));
        return this.cmdNumsAsync(3 /* DAP_DISCONNECT */, [])
            .then(function () {
            return devClose();
        });
    };
    Dap.prototype.connectAsync = function () {
        var _this = this;
        info("Connecting...");
        var devOpen = Promise.promisify(this.dev.open.bind(this.dev));
        return devOpen()
            .then(function () {
            var deviceInfo = _this.dev.getDeviceInfo();
            if (deviceInfo && (deviceInfo.manufacturer === 'Atmel Corp.' || deviceInfo.vendorId === 0x03eb)) {
                _this.packetLength = 513;
            }
        })
            .then(function () {
            return _this.infoAsync(254 /* PACKET_COUNT */);
        })
            .then(function (v) {
            _this.maxSent = v;
        })
            .then(function () { return _this.cmdNumsAsync(17 /* DAP_SWJ_CLOCK */, addInt32(null, 1000000)); })
            .then(function () { return _this.cmdNumsAsync(2 /* DAP_CONNECT */, [1]); })
            .then(function (buf) {
            if (buf[1] != 1)
                error("Non SWD");
            // 1MHz
            return _this.cmdNumsAsync(17 /* DAP_SWJ_CLOCK */, addInt32(null, 1000000));
        })
            .then(function () { return _this.cmdNumsAsync(4 /* DAP_TRANSFER_CONFIGURE */, [0, 0x50, 0, 0, 0]); })
            .then(function () { return _this.cmdNumsAsync(19 /* DAP_SWD_CONFIGURE */, [0]); })
            .then(function () { return _this.jtagToSwdAsync(); })
            .then(function () { return info("Connected."); });
    };
    return Dap;
}());
exports.Dap = Dap;
function promiseWhileAsync(fnAsync) {
    var loopAsync = function (cond) {
        return cond ? fnAsync().then(loopAsync) : Promise.resolve();
    };
    return loopAsync(true);
}
function promiseIterAsync(elts, f) {
    var i = -1;
    var loop = function () {
        if (++i >= elts.length)
            return Promise.resolve();
        return f(elts[i], i).then(loop);
    };
    return loop();
}
function promiseMapSeqAsync(elts, f) {
    var res = [];
    return promiseIterAsync(elts, function (v) { return f(v).then(function (z) { res.push(z); }); })
        .then(function () { return res; });
}
function range(n) {
    var r = [];
    for (var i = 0; i < n; ++i)
        r.push(i);
    return r;
}
var Breakpoint = (function () {
    function Breakpoint(parent, index) {
        this.parent = parent;
        this.index = index;
    }
    Breakpoint.prototype.readAsync = function () {
        var _this = this;
        return this.parent.readMemAsync(3758104584 /* FP_COMP0 */ + this.index * 4)
            .then(function (n) {
            console.log("idx=" + _this.index + ", CURR=" + n + ", LAST=" + _this.lastWritten);
        });
    };
    Breakpoint.prototype.writeAsync = function (num) {
        // Doesn't seem to work
        //if (num == this.lastWritten) return Promise.resolve()
        this.lastWritten = num;
        return this.parent.writeMemAsync(3758104584 /* FP_COMP0 */ + this.index * 4, num);
        //.then(() => this.readAsync())
    };
    return Breakpoint;
}());
exports.Breakpoint = Breakpoint;
function assert(cond) {
    if (!cond) {
        throw new Error("assertion failed");
    }
}
var Device = (function () {
    function Device(path) {
        this.path = path;
        this.dap = new Dap(path);
    }
    Device.prototype.clearCaches = function () {
        delete this.dpSelect;
        delete this.csw;
        for (var _i = 0, _a = this.breakpoints; _i < _a.length; _i++) {
            var b = _a[_i];
            delete b.lastWritten;
        }
    };
    Device.prototype.reconnectAsync = function () {
        var _this = this;
        this.clearCaches();
        return this.dap.disconnectAsync()
            .then(function () { return Promise.delay(100); })
            .then(function () { return _this.initAsync(); });
        // it seems we do not have to actually close the USB connection
        /*
    let dev = this.dap.dev
    // see https://github.com/node-hid/node-hid/issues/61
    dev.removeAllListeners() // unregister on(data) event
    dev.write([0, 0, 7]) // write something so that it responds
    dev.close() // now can close the device
    this.dap = null
    return Promise.delay(2000)
        .then(() => {
            this.dap = new Dap(this.path)
            return this.initAsync()
        })
        */
    };
    Device.prototype.initAsync = function () {
        var _this = this;
        return this.dap.connectAsync()
            .then(function () { return _this.readDpAsync(0 /* IDCODE */); })
            .then(function (n) { _this.idcode = n; })
            .then(function () { return _this.writeRegAsync(0 /* DP_0x0 */, 1 << 2); }) // clear sticky error
            .then(function () { return _this.writeDpAsync(2 /* SELECT */, 0); })
            .then(function () { return _this.writeDpAsync(1 /* CTRL_STAT */, 1073741824 /* CSYSPWRUPREQ */ | 268435456 /* CDBGPWRUPREQ */); })
            .then(function () {
            var m = 536870912 /* CDBGPWRUPACK */ | 2147483648 /* CSYSPWRUPACK */;
            return promiseWhileAsync(function () {
                return _this.readDpAsync(1 /* CTRL_STAT */)
                    .then(function (v) { return (v & m) != m; });
            });
        })
            .then(function () { return _this.writeDpAsync(1 /* CTRL_STAT */, 1073741824 /* CSYSPWRUPREQ */ | 268435456 /* CDBGPWRUPREQ */ | 0 /* TRNNORMAL */ | 3840 /* MASKLANE */); })
            .then(function () { return _this.writeDpAsync(2 /* SELECT */, 0); })
            .then(function () { return _this.readApAsync(252 /* IDR */); })
            .then(function () { return _this.setupFpbAsync(); })
            .then(function () { return info("Initialized."); });
    };
    Device.prototype.closeAsync = function () {
        return this.dap.disconnectAsync();
    };
    Device.prototype.writeRegAsync = function (regId, val) {
        if (val === null)
            error("bad val");
        info("writeReg(" + rid(regId) + ", " + hex(val) + ")");
        return this.regOpAsync(regId, val)
            .then(function () {
        });
    };
    Device.prototype.readRegAsync = function (regId) {
        return this.regOpAsync(regId, null)
            .then(function (buf) {
            var v = readUInt32LE(buf, 3);
            info("readReg(" + rid(regId) + ") = " + hex(v));
            return v;
        });
    };
    Device.prototype.readDpAsync = function (addr) {
        return this.readRegAsync(addr);
    };
    Device.prototype.readApAsync = function (addr) {
        var _this = this;
        return this.writeDpAsync(2 /* SELECT */, bank(addr))
            .then(function () { return _this.readRegAsync(apReg(addr, 2 /* READ */)); });
    };
    Device.prototype.writeDpAsync = function (addr, data) {
        if (addr == 2 /* SELECT */) {
            if (data === this.dpSelect)
                return Promise.resolve();
            this.dpSelect = data;
        }
        return this.writeRegAsync(addr, data);
    };
    Device.prototype.writeApAsync = function (addr, data) {
        var _this = this;
        return this.writeDpAsync(2 /* SELECT */, bank(addr))
            .then(function () {
            if (addr == 0 /* CSW */) {
                if (data === _this.csw)
                    return Promise.resolve();
                _this.csw = data;
            }
            return _this.writeRegAsync(apReg(addr, 0 /* WRITE */), data);
        });
    };
    Device.prototype.writeMemAsync = function (addr, data) {
        var _this = this;
        //console.log(`wr: ${addr.toString(16)} := ${data}`)
        return this.writeApAsync(0 /* CSW */, 587202640 /* CSW_VALUE */ | 2 /* CSW_SIZE32 */)
            .then(function () { return _this.writeApAsync(4 /* TAR */, addr); })
            .then(function () { return _this.writeApAsync(12 /* DRW */, data); });
    };
    Device.prototype.readMemAsync = function (addr) {
        var _this = this;
        return this.writeApAsync(0 /* CSW */, 587202640 /* CSW_VALUE */ | 2 /* CSW_SIZE32 */)
            .then(function () { return _this.writeApAsync(4 /* TAR */, addr); })
            .then(function () { return _this.readApAsync(12 /* DRW */); })
            .catch(function (e) {
            if (e.dapWait) {
                console.log("transfer wait, read at 0x" + addr.toString(16));
                return Promise.delay(100).then(function () { return _this.readMemAsync(addr); });
            }
            else
                return Promise.reject(e);
        });
    };
    Device.prototype.haltAsync = function () {
        return this.writeMemAsync(3758157296 /* DHCSR */, -1604386816 /* DBGKEY */ | 1 /* C_DEBUGEN */ | 2 /* C_HALT */);
    };
    Device.prototype.isHaltedAsync = function () {
        return this.statusAsync().then(function (s) { return s.isHalted; });
    };
    Device.prototype.statusAsync = function () {
        var _this = this;
        return this.readMemAsync(3758157296 /* DHCSR */)
            .then(function (dhcsr) { return _this.readMemAsync(3758157104 /* DFSR */)
            .then(function (dfsr) { return ({
            dhcsr: dhcsr,
            dfsr: dfsr,
            isHalted: !!(dhcsr & 131072 /* S_HALT */)
        }); }); });
    };
    Device.prototype.debugEnableAsync = function () {
        return this.writeMemAsync(3758157296 /* DHCSR */, -1604386816 /* DBGKEY */ | 1 /* C_DEBUGEN */);
    };
    Device.prototype.resumeAsync = function () {
        var _this = this;
        return this.isHaltedAsync()
            .then(function (halted) {
            if (halted)
                return _this.writeMemAsync(3758157104 /* DFSR */, 4 /* DFSR_DWTTRAP */ | 2 /* DFSR_BKPT */ | 1 /* DFSR_HALTED */)
                    .then(function () { return _this.debugEnableAsync(); });
        });
    };
    Device.prototype.snapshotMachineStateAsync = function () {
        var _this = this;
        var state = {
            stack: null,
            registers: []
        };
        return promiseIterAsync(range(16), function (regno) { return _this.readCpuRegisterAsync(regno)
            .then(function (v) {
            state.registers[regno] = v;
        }); })
            .then(function () { return _this.readStackAsync(); })
            .then(function (stack) {
            state.stack = stack;
            return state;
        });
    };
    Device.prototype.restoreMachineState = function (state) {
        var _this = this;
        return promiseIterAsync(state.registers, function (val, idx) { return val === null
            ? Promise.resolve()
            : _this.writeCpuRegisterAsync(idx, val); })
            .then(function () { return _this.writeBlockAsync(STACK_BASE - state.stack.length * 4, state.stack); });
    };
    Device.prototype.waitForHaltAsync = function () {
        var _this = this;
        return promiseWhileAsync(function () { return _this.isHaltedAsync().then(function (v) {
            if (v)
                return false;
            return Promise.delay(50).then(function () { return true; });
        }); });
    };
    Device.prototype.executeCodeAsync = function (code, args, quick) {
        var _this = this;
        if (quick === void 0) { quick = false; }
        code = code.concat([0xbe2a]); // 'bkpt 42'; possible zero-padding will be interpreted as 'movs r0, r0'
        var baseAddr = STACK_BASE - code.length * 4;
        var state = {
            stack: code,
            registers: args.slice()
        };
        while (state.registers.length < 16) {
            state.registers.push(quick ? null : 0);
        }
        state.registers[14 /* LR */] = STACK_BASE - 4 + 1; // 'bkpt' instruction we added; +1 for Thumb state
        state.registers[13 /* SP */] = baseAddr;
        state.registers[15 /* PC */] = baseAddr;
        if (quick)
            state.stack = [];
        return this.restoreMachineState(state)
            .then(function () { return _this.resumeAsync(); });
    };
    Device.prototype.writePagesAsync = function (info) {
        var _this = this;
        var currBuf = 0;
        var bufPtr = 0;
        var dstAddr = info.flashAddr;
        var waitForStopAsync = function () { return promiseWhileAsync(function () {
            return _this.isHaltedAsync()
                .then(function (h) { return !h; });
        }); };
        var quickRun = false;
        var loopAsync = function () {
            return Promise.resolve()
                .then(function () {
                var nextPtr = bufPtr + PAGE_SIZE / 4;
                var sl = info.flashWords.slice(bufPtr, nextPtr);
                bufPtr = nextPtr;
                return _this.writeBlockAsync(info.bufferAddr + currBuf * PAGE_SIZE, sl);
            })
                .then(waitForStopAsync)
                .then(function () { return _this.executeCodeAsync(info.flashCode, [dstAddr, info.bufferAddr + currBuf * PAGE_SIZE], quickRun); })
                .then(function () {
                quickRun = true;
                currBuf++;
                dstAddr += PAGE_SIZE;
                if (currBuf >= info.numBuffers)
                    currBuf = 0;
                if (bufPtr < info.flashWords.length)
                    return loopAsync();
                else
                    return waitForStopAsync();
            });
        };
        return this.haltAsync()
            .then(loopAsync)
            .then(function () { return Promise.delay(200); })
            .then(function () { return _this.resetCoreAsync(); });
    };
    Device.prototype.isThreadHaltedAsync = function () {
        var _this = this;
        return this.isHaltedAsync()
            .then(function (v) {
            if (!v)
                return false;
            return _this.readCpuRegisterAsync(20 /* PRIMASK */)
                .then(function (v) {
                if (v & 1)
                    return false;
                else
                    return _this.readCpuRegisterAsync(16 /* XPSR */)
                        .then(function (v) {
                        if (v & 0x3f)
                            return false;
                        else
                            return true;
                    });
            });
        });
    };
    Device.prototype.safeHaltAsync = function () {
        var _this = this;
        return this.isThreadHaltedAsync()
            .then(function (halted) {
            if (!halted) {
                return promiseWhileAsync(function () { return _this.haltAsync()
                    .then(function () { return _this.isThreadHaltedAsync(); })
                    .then(function (safe) {
                    if (safe)
                        return false;
                    else
                        return _this.resumeAsync().then(function () { return true; });
                }); });
            }
        });
    };
    Device.prototype.setBreakpointsAsync = function (addrs) {
        var _this = this;
        function mapAddr(addr) {
            if (addr === null)
                return 0;
            if ((addr & 3) == 2)
                return 0x80000001 | (addr & ~3);
            else if ((addr & 3) == 0)
                return 0x40000001 | (addr & ~3);
            else
                error("uneven address");
        }
        if (addrs.length > this.breakpoints.length)
            error("not enough hw breakpoints");
        return this.debugEnableAsync()
            .then(function () { return _this.setFpbEnabledAsync(true); })
            .then(function () {
            while (addrs.length < _this.breakpoints.length)
                addrs.push(null);
            return promiseIterAsync(addrs, function (addr, i) {
                return _this.breakpoints[i].writeAsync(mapAddr(addr));
            });
        });
    };
    Device.prototype.setFpbEnabledAsync = function (enabled) {
        if (enabled === void 0) { enabled = true; }
        return this.writeMemAsync(3758104576 /* FP_CTRL */, 2 /* FP_CTRL_KEY */ | (enabled ? 1 : 0));
    };
    Device.prototype.setupFpbAsync = function () {
        // Reads the number of hardware breakpoints available on the core
        // and disable the FPB (Flash Patch and Breakpoint Unit)
        // which will be enabled when a first breakpoint will be set
        var _this = this;
        // setup FPB (breakpoint)
        return this.readMemAsync(3758104576 /* FP_CTRL */)
            .then(function (fpcr) {
            var nb_code = ((fpcr >> 8) & 0x70) | ((fpcr >> 4) & 0xF);
            var nb_lit = (fpcr >> 7) & 0xf;
            if (nb_code == 0)
                error("invalid initialization");
            info(nb_code + " hardware breakpoints, " + nb_lit + " literal comparators");
            _this.breakpoints = range(nb_code).map(function (i) { return new Breakpoint(_this, i); });
            return _this.setFpbEnabledAsync(false);
        })
            .then(function () { return Promise.map(_this.breakpoints, function (b) { return b.writeAsync(0); }); });
    };
    Device.prototype.resetCoreAsync = function () {
        return this.writeMemAsync(3758157068 /* NVIC_AIRCR */, 100270080 /* NVIC_AIRCR_VECTKEY */ | 4 /* NVIC_AIRCR_SYSRESETREQ */)
            .then(function () { });
    };
    Device.prototype.readCpuRegisterAsync = function (no) {
        var _this = this;
        return this.writeMemAsync(3758157300 /* DCRSR */, no)
            .then(function () { return _this.readMemAsync(3758157296 /* DHCSR */); })
            .then(function (v) { return assert(v & 65536 /* S_REGRDY */); })
            .then(function () { return _this.readMemAsync(3758157304 /* DCRDR */); });
    };
    Device.prototype.writeCpuRegisterAsync = function (no, val) {
        var _this = this;
        return this.writeMemAsync(3758157304 /* DCRDR */, val)
            .then(function () { return _this.writeMemAsync(3758157300 /* DCRSR */, no | 65536 /* DCRSR_REGWnR */); })
            .then(function () { return _this.readMemAsync(3758157296 /* DHCSR */); })
            .then(function (v) {
            assert(v & 65536 /* S_REGRDY */);
        });
    };
    Device.prototype.readStateAsync = function () {
        var _this = this;
        var r = {
            pc: 0,
            lr: 0,
            stack: []
        };
        return this.readStackAsync()
            .then(function (s) { return r.stack = s; })
            .then(function () { return _this.readCpuRegisterAsync(15 /* PC */); })
            .then(function (v) { return r.pc = v; })
            .then(function () { return _this.readCpuRegisterAsync(14 /* LR */); })
            .then(function (v) { return r.lr = v; })
            .then(function () { return r; });
    };
    Device.prototype.regOpAsync = function (regId, val) {
        var request = regRequest(regId, val !== null);
        var sendargs = [0, 1, request];
        if (val !== null)
            addInt32(sendargs, val);
        return this.dap.cmdNumsAsync(5 /* DAP_TRANSFER */, sendargs)
            .then(function (buf) {
            if (buf[1] != 1)
                error("Bad #trans " + buf[1], true);
            if (buf[2] != 1) {
                if (buf[2] == 2)
                    error("Transfer wait", true, true);
                error("Bad transfer status " + buf[2], true);
            }
            return buf;
        });
    };
    Device.prototype.readRegRepeatAsync = function (regId, cnt) {
        assert(cnt <= 15);
        var request = regRequest(regId);
        var sendargs = [0, cnt];
        for (var i = 0; i < cnt; ++i)
            sendargs.push(request);
        return this.dap.cmdNumsAsync(5 /* DAP_TRANSFER */, sendargs)
            .then(function (buf) {
            if (buf[1] != cnt)
                error("(many) Bad #trans " + buf[1]);
            if (buf[2] != 1)
                error("(many) Bad transfer status " + buf[2]);
            return buf.slice(3, 3 + cnt * 4);
        });
    };
    Device.prototype.writeRegRepeatAsync = function (regId, data) {
        assert(data.length <= 15);
        var request = regRequest(regId, true);
        var sendargs = [0, data.length];
        for (var i = 0; i < data.length; ++i) {
            sendargs.push(request);
            addInt32(sendargs, data[i]);
        }
        return this.dap.cmdNumsAsync(5 /* DAP_TRANSFER */, sendargs)
            .then(function (buf) {
            if (buf[2] != 1)
                error("(many-wr) Bad transfer status " + buf[2], true, true);
        });
    };
    Device.prototype.readBlockAsync = function (addr, words) {
        var _this = this;
        var funs = [function () { return Promise.resolve(); }];
        var bufs = [];
        var end = addr + words * 4;
        var ptr = addr;
        var _loop_1 = function() {
            var nextptr = ptr + PAGE_SIZE;
            if (ptr == addr) {
                nextptr &= ~(PAGE_SIZE - 1);
            }
            (function () {
                var len = Math.min(nextptr - ptr, end - ptr);
                var ptr0 = ptr;
                assert((len & 3) == 0);
                funs.push(function () {
                    return _this.readBlockCoreAsync(ptr0, len >> 2)
                        .then(function (b) {
                        bufs.push(b);
                    });
                });
            })();
            ptr = nextptr;
        };
        while (ptr < end) {
            _loop_1();
        }
        return promiseIterAsync(funs, function (f) { return f(); })
            .then(function () { return bufferConcat(bufs); });
    };
    Device.prototype.readBlockCoreAsync = function (addr, words) {
        var _this = this;
        return this.writeApAsync(0 /* CSW */, 587202640 /* CSW_VALUE */ | 2 /* CSW_SIZE32 */)
            .then(function () { return _this.writeApAsync(4 /* TAR */, addr); })
            .then(function () {
            var blocks = range(Math.ceil(words / 15));
            var lastSize = words % 15;
            if (lastSize == 0)
                lastSize = 15;
            var bufs = [];
            return Promise.map(blocks, function (no) { return _this.readRegRepeatAsync(apReg(12 /* DRW */, 2 /* READ */), no == blocks.length - 1 ? lastSize : 15); })
                .then(function (bufs) { return bufferConcat(bufs); });
        });
    };
    Device.prototype.writeBlockAsync = function (addr, words) {
        var _this = this;
        if (words.length == 0)
            return Promise.resolve();
        console.log("write block: 0x" + addr.toString(16) + " " + words.length + " len");
        if (1 > 0)
            return this.writeBlockCoreAsync(addr, words)
                .then(function () { return console.log("written"); });
        var blSz = 10;
        var blocks = range(Math.ceil(words.length / blSz));
        return promiseIterAsync(blocks, function (no) {
            return _this.writeBlockCoreAsync(addr + no * blSz * 4, words.slice(no * blSz, no * blSz + blSz));
        })
            .then(function () { return console.log("written"); });
    };
    Device.prototype.writeBlockCoreAsync = function (addr, words) {
        var _this = this;
        return this.writeApAsync(0 /* CSW */, 587202640 /* CSW_VALUE */ | 2 /* CSW_SIZE32 */)
            .then(function () { return _this.writeApAsync(4 /* TAR */, addr); })
            .then(function () {
            var blSz = 12; // with 15 we get strange errors
            var blocks = range(Math.ceil(words.length / blSz));
            var reg = apReg(12 /* DRW */, 0 /* WRITE */);
            return Promise.map(blocks, function (no) { return _this.writeRegRepeatAsync(reg, words.slice(no * blSz, no * blSz + blSz)); })
                .then(function () { });
        })
            .catch(function (e) {
            if (e.dapWait) {
                console.log("transfer wait, write block");
                return Promise.delay(100).then(function () { return _this.writeBlockCoreAsync(addr, words); });
            }
            else
                return Promise.reject(e);
        });
    };
    Device.prototype.snapshotHexAsync = function () {
        return this.readBlockAsync(0, 256 * 1024 / 4)
            .then(function (buf) {
            var upper = -1;
            var addr = 0;
            var myhex = [];
            while (addr < buf.length) {
                if ((addr >> 16) != upper) {
                    upper = addr >> 16;
                    myhex.push(hexBytes([0x02, 0x00, 0x00, 0x04, upper >> 8, upper & 0xff]));
                }
                var bytes = [0x10, (addr >> 8) & 0xff, addr & 0xff, 0];
                for (var i = 0; i < 16; ++i)
                    bytes.push(buf[addr + i]);
                myhex.push(hexBytes(bytes));
                addr += 16;
            }
            myhex.push(":020000041000EA");
            myhex.push(":0410140000C0030015");
            myhex.push(":040000050003C0C173");
            myhex.push(":00000001FF");
            myhex.push("");
            return myhex.join("\r\n");
        });
    };
    Device.prototype.readIdCodeAsync = function () {
        return this.readDpAsync(0 /* IDCODE */);
    };
    Device.prototype.readStackAsync = function () {
        var _this = this;
        return this.readCpuRegisterAsync(13 /* SP */)
            .then(function (sp) {
            var size = STACK_BASE - sp;
            if ((size & 3) || size < 0 || size > 8 * 1024)
                error("Bad SP: " + hex(sp));
            return _this.readBlockAsync(sp, size / 4);
        })
            .then(bufToUint32Array);
    };
    return Device;
}());
exports.Device = Device;
function hexBytes(bytes) {
    var chk = 0;
    var r = ":";
    bytes.forEach(function (b) { return chk += b; });
    bytes.push((-chk) & 0xff);
    bytes.forEach(function (b) { return r += ("0" + b.toString(16)).slice(-2); });
    return r.toUpperCase();
}
function arrToString(arr) {
    var r = "";
    for (var i = 0; i < arr.length; ++i) {
        r += ("0000" + i).slice(-4) + ": " + ("00000000" + (arr[i] >>> 0).toString(16)).slice(-8) + "\n";
    }
    return r;
}
function machineStateToString(s) {
    return "\n\nREGS:\n" + arrToString(s.registers) + "\n\nSTACK:\n" + arrToString(s.stack) + "\n";
}
function bufToUint32Array(buf) {
    assert((buf.length & 3) == 0);
    var r = [];
    if (!buf.length)
        return r;
    r[buf.length / 4 - 1] = 0;
    for (var i = 0; i < r.length; ++i)
        r[i] = readUInt32LE(buf, i << 2);
    return r;
}
function regRequest(regId, isWrite) {
    if (isWrite === void 0) { isWrite = false; }
    var request = !isWrite ? 2 /* READ */ : 0 /* WRITE */;
    if (regId < 4)
        request |= 0 /* DP_ACC */;
    else
        request |= 1 /* AP_ACC */;
    request |= (regId & 3) << 2;
    return request;
}
function timeAsync(lbl, f) {
    return function () {
        var n = Date.now();
        return f().then(function (v) {
            var d = Date.now() - n;
            console.log(lbl + ": " + d + "ms");
            return v;
        });
    };
}
function getMbedDevices() {
    var devices = HID.devices();
    return devices.filter(function (d) { return /MBED CMSIS-DAP/.test(d.product); });
}
exports.getMbedDevices = getMbedDevices;
function getEdbgDevices() {
    var devices = HID.devices();
    return devices.filter(function (d) { return /EDBG CMSIS-DAP/.test(d.product); });
}
exports.getEdbgDevices = getEdbgDevices;
function getEdbgDevicesAsync() {
    var hidDevices = Promise.promisify(HID.devices.bind(HID));
    return hidDevices()
        .then(function (devices) {
        return devices.filter(function (d) { return /EDBG CMSIS-DAP/.test(d.product); });
    });
}
exports.getEdbgDevicesAsync = getEdbgDevicesAsync;
var devices = {};
function getDeviceAsync(path) {
    if (devices[path])
        return devices[path];
    var d = new Device(path);
    return (devices[path] = d.initAsync().then(function () { return d; }));
}
function handleDevMsgAsync(msg) {
    if (!msg.path)
        error("path missing");
    // TODO enforce queue per path?
    return getDeviceAsync(msg.path)
        .then(function (dev) {
        switch (msg.op) {
            case "halt": return dev.safeHaltAsync().then(function () { return ({}); });
            case "snapshot": return dev.snapshotMachineStateAsync()
                .then(function (v) { return ({ state: v }); });
            case "restore": return dev.restoreMachineState(msg.state);
            case "resume": return dev.resumeAsync();
            case "reset": return dev.resetCoreAsync();
            case "breakpoints": return dev.setBreakpointsAsync(msg.addrs);
            case "status": return dev.statusAsync();
            case "bgexec":
                return dev.executeCodeAsync(msg.code, msg.args || []);
            case "exec":
                return dev.executeCodeAsync(msg.code, msg.args || [])
                    .then(function () { return dev.waitForHaltAsync(); });
            case "wrpages":
                return dev.writePagesAsync(msg);
            case "wrmem":
                return dev.writeBlockAsync(msg.addr, msg.words);
            case "mem":
                return dev.readBlockAsync(msg.addr, msg.words)
                    .then(function (buf) {
                    var res = [];
                    for (var i = 0; i < buf.length; i += 4)
                        res.push(readUInt32LE(buf, i));
                    return { data: res };
                });
        }
    });
}
function handleMessageAsync(msg) {
    switch (msg.op) {
        case "list": return Promise.resolve({ devices: getMbedDevices() });
        default:
            return handleDevMsgAsync(msg)
                .then(function (v) { return v; }, function (err) {
                if (!err.dapReconnect)
                    return Promise.reject(err);
                console.log("re-connecting, ", err.message);
                return getDeviceAsync(msg.path)
                    .then(function (dev) { return dev.reconnectAsync(); })
                    .then(function () { return handleDevMsgAsync(msg); });
            });
    }
}
exports.handleMessageAsync = handleMessageAsync;
var code = [0x4770b403, 0xb500bc03, 0x219620ff, 0x47984b01, 0xbd00, 0x18451];
function logMachineState(lbl) {
    return function (s) {
        //console.log(machineStateToString(s).replace(/^/gm, lbl + ": "))
        return s;
    };
}
function main() {
    var mydev = getMbedDevices()[0];
    var d = new Device(mydev.path);
    var st;
    d.initAsync()
        .then(function () { return d.haltAsync(); })
        .then(function () { return d.snapshotHexAsync(); })
        .then(function (h) {
        require("fs").writeFileSync("microbit.hex", h);
        process.exit(0);
    })
        .then(function () { return d.snapshotMachineStateAsync(); })
        .then(function (s) { return st = s; })
        .then(function () { return d.executeCodeAsync(code, [0xbeef, 0xf00, 0xf00d0, 0xffff00]); })
        .then(function () { return d.waitForHaltAsync(); })
        .then(function () { return d.snapshotMachineStateAsync(); })
        .then(logMachineState("final"))
        .then(function (st) { console.log(hex(st.stack[0])); })
        .then(function () { return d.restoreMachineState(st); })
        .then(function () { return d.resumeAsync(); })
        .then(function () { return process.exit(0); });
    /*
        .then(() => d.haltAsync())
        .then(() => d.readStackAsync())
        .then(arr => {
            for (let i = 0; i < arr.length; ++i)
                console.log(i, hex(arr[i]))
        })
        .then(timeAsync("readmem", () => d.readBlockAsync(0x20000000, 16 / 4 * 1024)))
        .then(v => console.log(v.length, v))
        */
    /*
    .then(() => promiseIterAsync(range(16), k =>
        d.readCpuRegisterAsync(k)
            .then(v => console.log(`r${k} = ${hex(v)}`))))
            */
}
if (require.main === module) {
    main();
}
