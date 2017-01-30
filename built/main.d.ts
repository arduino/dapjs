/// <reference path="../typings/index.d.ts" />
import * as Promise from "bluebird";
export declare const enum DapCmd {
    DAP_INFO = 0,
    DAP_LED = 1,
    DAP_CONNECT = 2,
    DAP_DISCONNECT = 3,
    DAP_TRANSFER_CONFIGURE = 4,
    DAP_TRANSFER = 5,
    DAP_TRANSFER_BLOCK = 6,
    DAP_TRANSFER_ABORT = 7,
    DAP_WRITE_ABORT = 8,
    DAP_DELAY = 9,
    DAP_RESET_TARGET = 10,
    DAP_SWJ_PINS = 16,
    DAP_SWJ_CLOCK = 17,
    DAP_SWJ_SEQUENCE = 18,
    DAP_SWD_CONFIGURE = 19,
    DAP_JTAG_SEQUENCE = 20,
    DAP_JTAG_CONFIGURE = 21,
    DAP_JTAG_IDCODE = 22,
    DAP_VENDOR0 = 128,
}
export declare const enum Reg {
    DP_0x0 = 0,
    DP_0x4 = 1,
    DP_0x8 = 2,
    DP_0xC = 3,
    AP_0x0 = 4,
    AP_0x4 = 5,
    AP_0x8 = 6,
    AP_0xC = 7,
    IDCODE = 0,
    ABORT = 0,
    CTRL_STAT = 1,
    SELECT = 2,
}
export declare const enum ApReg {
    CSW = 0,
    TAR = 4,
    DRW = 12,
    IDR = 252,
}
export declare const enum CortexReg {
    R0 = 0,
    R1 = 1,
    R2 = 2,
    R3 = 3,
    R4 = 4,
    R5 = 5,
    R6 = 6,
    R7 = 7,
    R8 = 8,
    R9 = 9,
    R10 = 10,
    R11 = 11,
    R12 = 12,
    SP = 13,
    LR = 14,
    PC = 15,
    XPSR = 16,
    MSP = 17,
    PSP = 18,
    PRIMASK = 20,
    CONTROL = 20,
}
export declare class Dap {
    dev: any;
    private sent;
    private waiting;
    private maxSent;
    private packetLength;
    constructor(path: string);
    private pokeWaiting();
    private sendNums(lst);
    private jtagToSwdAsync();
    private swjSequenceAsync(data);
    cmdNumsAsync(op: DapCmd, data: number[]): Promise<Uint8Array>;
    private infoAsync(id);
    resetTargetAsync(): Promise<Uint8Array>;
    disconnectAsync(): Promise<{}>;
    connectAsync(): Promise<void>;
}
export declare class Breakpoint {
    parent: Device;
    index: number;
    lastWritten: number;
    constructor(parent: Device, index: number);
    readAsync(): Promise<void>;
    writeAsync(num: number): Promise<void>;
}
export declare class Device {
    private path;
    private dpSelect;
    private csw;
    idcode: number;
    dap: Dap;
    breakpoints: Breakpoint[];
    constructor(path: string);
    private clearCaches();
    reconnectAsync(): Promise<void>;
    initAsync(): Promise<void>;
    closeAsync(): Promise<{}>;
    writeRegAsync(regId: Reg, val: number): Promise<void>;
    readRegAsync(regId: Reg): Promise<number>;
    readDpAsync(addr: Reg): Promise<number>;
    readApAsync(addr: ApReg): Promise<number>;
    writeDpAsync(addr: Reg, data: number): Promise<void>;
    writeApAsync(addr: ApReg, data: number): Promise<void>;
    writeMemAsync(addr: number, data: number): Promise<void>;
    readMemAsync(addr: number): Promise<number>;
    haltAsync(): Promise<void>;
    isHaltedAsync(): Promise<boolean>;
    statusAsync(): Promise<{
        dhcsr: number;
        dfsr: number;
        isHalted: boolean;
    }>;
    debugEnableAsync(): Promise<void>;
    resumeAsync(): Promise<void>;
    snapshotMachineStateAsync(): Promise<MachineState>;
    restoreMachineState(state: MachineState): Promise<void>;
    waitForHaltAsync(): Promise<void>;
    executeCodeAsync(code: number[], args: number[], quick?: boolean): Promise<void>;
    writePagesAsync(info: FlashData): Promise<void>;
    isThreadHaltedAsync(): Promise<boolean>;
    safeHaltAsync(): Promise<void>;
    setBreakpointsAsync(addrs: number[]): Promise<void>;
    setFpbEnabledAsync(enabled?: boolean): Promise<void>;
    setupFpbAsync(): Promise<void[]>;
    resetCoreAsync(): Promise<void>;
    readCpuRegisterAsync(no: CortexReg): Promise<number>;
    writeCpuRegisterAsync(no: CortexReg, val: number): Promise<void>;
    readStateAsync(): Promise<CpuState>;
    private regOpAsync(regId, val);
    readRegRepeatAsync(regId: Reg, cnt: number): Promise<Uint8Array>;
    writeRegRepeatAsync(regId: Reg, data: number[]): Promise<void>;
    readBlockAsync(addr: number, words: number): Promise<Uint8Array>;
    private readBlockCoreAsync(addr, words);
    writeBlockAsync(addr: number, words: number[]): Promise<void>;
    writeBlockCoreAsync(addr: number, words: number[]): Promise<void>;
    snapshotHexAsync(): Promise<string>;
    readIdCodeAsync(): Promise<number>;
    readStackAsync(): Promise<number[]>;
}
export interface FlashData {
    flashCode: number[];
    flashWords: number[];
    numBuffers: number;
    bufferAddr: number;
    flashAddr: number;
}
export interface CpuState {
    pc: number;
    lr: number;
    stack: number[];
}
export interface MachineState {
    registers: number[];
    stack: number[];
}
export interface HidDevice {
    product: string;
    path: string;
}
export declare function getMbedDevices(): HidDevice[];
export declare function getEdbgDevices(): HidDevice[];
export declare function getEdbgDevicesAsync(): Promise<HidDevice[]>;
export interface Map<T> {
    [n: string]: T;
}
export declare function handleMessageAsync(msg: any): Promise<any>;
