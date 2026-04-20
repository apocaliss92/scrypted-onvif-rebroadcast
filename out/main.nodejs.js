/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/@scrypted/sdk/dist/src/index.js"
/*!******************************************************!*\
  !*** ./node_modules/@scrypted/sdk/dist/src/index.js ***!
  \******************************************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.sdk = exports.MixinDeviceBase = exports.ScryptedDeviceBase = void 0;
__exportStar(__webpack_require__(/*! ../types/gen/index */ "./node_modules/@scrypted/sdk/dist/types/gen/index.js"), exports);
const fs_1 = __importDefault(__webpack_require__(/*! fs */ "fs"));
const index_1 = __webpack_require__(/*! ../types/gen/index */ "./node_modules/@scrypted/sdk/dist/types/gen/index.js");
const module_1 = __webpack_require__(/*! module */ "module");
/**
 * @category Core Reference
 */
class ScryptedDeviceBase extends index_1.DeviceBase {
    constructor(nativeId) {
        super();
        this.nativeId = nativeId;
    }
    get storage() {
        if (!this._storage) {
            this._storage = exports.sdk.deviceManager.getDeviceStorage(this.nativeId);
        }
        return this._storage;
    }
    get log() {
        if (!this._log) {
            this._log = exports.sdk.deviceManager.getDeviceLogger(this.nativeId);
        }
        return this._log;
    }
    get console() {
        if (!this._console) {
            this._console = exports.sdk.deviceManager.getDeviceConsole(this.nativeId);
        }
        return this._console;
    }
    async createMediaObject(data, mimeType) {
        return exports.sdk.mediaManager.createMediaObject(data, mimeType, {
            sourceId: this.id,
        });
    }
    getMediaObjectConsole(mediaObject) {
        if (typeof mediaObject.sourceId !== 'string')
            return this.console;
        return exports.sdk.deviceManager.getMixinConsole(mediaObject.sourceId, this.nativeId);
    }
    _lazyLoadDeviceState() {
        if (!this._deviceState) {
            if (this.nativeId) {
                this._deviceState = exports.sdk.deviceManager.getDeviceState(this.nativeId);
            }
            else {
                this._deviceState = exports.sdk.deviceManager.getDeviceState();
            }
        }
    }
    /**
     * Fire an event for this device.
     */
    onDeviceEvent(eventInterface, eventData) {
        return exports.sdk.deviceManager.onDeviceEvent(this.nativeId, eventInterface, eventData);
    }
}
exports.ScryptedDeviceBase = ScryptedDeviceBase;
/**
 * @category Mixin Reference
 */
class MixinDeviceBase extends index_1.DeviceBase {
    constructor(options) {
        super();
        this._listeners = new Set();
        this.mixinDevice = options.mixinDevice;
        this.mixinDeviceInterfaces = options.mixinDeviceInterfaces;
        this.mixinStorageSuffix = options.mixinStorageSuffix;
        this._deviceState = options.mixinDeviceState;
        this.nativeId = exports.sdk.systemManager.getDeviceById(this.id).nativeId;
        this.mixinProviderNativeId = options.mixinProviderNativeId;
        // RpcProxy will trap all properties, and the following check/hack will determine
        // if the device state came from another node worker thread.
        // This should ultimately be discouraged and warned at some point in the future.
        if (this._deviceState.__rpcproxy_traps_all_properties && typeof this._deviceState.id === 'string') {
            this._deviceState = exports.sdk.deviceManager.createDeviceState(this._deviceState.id, this._deviceState.setState);
        }
    }
    get storage() {
        if (!this._storage) {
            const mixinStorageSuffix = this.mixinStorageSuffix;
            const mixinStorageKey = this.id + (mixinStorageSuffix ? ':' + mixinStorageSuffix : '');
            this._storage = exports.sdk.deviceManager.getMixinStorage(mixinStorageKey, this.mixinProviderNativeId);
        }
        return this._storage;
    }
    get console() {
        if (!this._console) {
            if (exports.sdk.deviceManager.getMixinConsole)
                this._console = exports.sdk.deviceManager.getMixinConsole(this.id, this.mixinProviderNativeId);
            else
                this._console = exports.sdk.deviceManager.getDeviceConsole(this.mixinProviderNativeId);
        }
        return this._console;
    }
    async createMediaObject(data, mimeType) {
        return exports.sdk.mediaManager.createMediaObject(data, mimeType, {
            sourceId: this.id,
        });
    }
    getMediaObjectConsole(mediaObject) {
        if (typeof mediaObject.sourceId !== 'string')
            return this.console;
        return exports.sdk.deviceManager.getMixinConsole(mediaObject.sourceId, this.mixinProviderNativeId);
    }
    /**
     * Fire an event for this device.
     */
    onDeviceEvent(eventInterface, eventData) {
        return exports.sdk.deviceManager.onMixinEvent(this.id, this, eventInterface, eventData);
    }
    _lazyLoadDeviceState() {
    }
    manageListener(listener) {
        this._listeners.add(listener);
    }
    release() {
        for (const l of this._listeners) {
            l.removeListener();
        }
    }
}
exports.MixinDeviceBase = MixinDeviceBase;
(function () {
    function _createGetState(state) {
        return function () {
            this._lazyLoadDeviceState();
            // @ts-ignore: accessing private property
            return this._deviceState?.[state];
        };
    }
    function _createSetState(state) {
        return function (value) {
            this._lazyLoadDeviceState();
            // @ts-ignore: accessing private property
            if (!this._deviceState) {
                console.warn('device state is unavailable. the device must be discovered with deviceManager.onDeviceDiscovered or deviceManager.onDevicesChanged before the state can be set.');
            }
            else {
                // @ts-ignore: accessing private property
                this._deviceState[state] = value;
            }
        };
    }
    for (const field of Object.values(index_1.ScryptedInterfaceProperty)) {
        if (field === index_1.ScryptedInterfaceProperty.nativeId)
            continue;
        Object.defineProperty(ScryptedDeviceBase.prototype, field, {
            set: _createSetState(field),
            get: _createGetState(field),
        });
        Object.defineProperty(MixinDeviceBase.prototype, field, {
            set: _createSetState(field),
            get: _createGetState(field),
        });
    }
})();
exports.sdk = {};
try {
    let loaded = false;
    try {
        // todo: remove usage of process.env.SCRYPTED_SDK_MODULE, only existed in prerelease builds.
        // import.meta is not a reliable way to detect es module support in webpack since webpack
        // evaluates that to true at runtime.
        const esModule = process.env.SCRYPTED_SDK_ES_MODULE || process.env.SCRYPTED_SDK_MODULE;
        const cjsModule = process.env.SCRYPTED_SDK_CJS_MODULE || process.env.SCRYPTED_SDK_MODULE;
        // @ts-expect-error
        if (esModule && "undefined" !== 'undefined') // removed by dead control flow
{}
        else if (cjsModule) {
            // @ts-expect-error
            if (typeof require !== 'undefined') {
                // @ts-expect-error
                const sdkModule = require(process.env.SCRYPTED_SDK_MODULE);
                Object.assign(exports.sdk, sdkModule.getScryptedStatic());
                loaded = true;
            }
            else {
                const sdkModule = __webpack_require__("./node_modules/@scrypted/sdk/dist/src sync recursive")(cjsModule);
                Object.assign(exports.sdk, sdkModule.getScryptedStatic());
                loaded = true;
            }
        }
    }
    catch (e) {
        console.warn("failed to load sdk module", e);
        throw e;
    }
    if (!loaded) {
        let runtimeAPI;
        try {
            runtimeAPI = pluginRuntimeAPI;
        }
        catch (e) {
        }
        Object.assign(exports.sdk, {
            log: deviceManager.getDeviceLogger(undefined),
            deviceManager,
            endpointManager,
            mediaManager,
            systemManager,
            pluginHostAPI,
            ...runtimeAPI,
        });
    }
    try {
        let descriptors = {
            ...index_1.ScryptedInterfaceDescriptors,
        };
        try {
            const sdkJson = JSON.parse(fs_1.default.readFileSync('../sdk.json').toString());
            const customDescriptors = sdkJson.interfaceDescriptors;
            if (customDescriptors) {
                descriptors = {
                    ...descriptors,
                    ...customDescriptors,
                };
            }
        }
        catch (e) {
            console.warn('failed to load custom interface descriptors', e);
        }
        exports.sdk.systemManager.setScryptedInterfaceDescriptors?.(index_1.TYPES_VERSION, descriptors)?.catch(() => { });
    }
    catch (e) {
    }
}
catch (e) {
    console.error('sdk initialization error, import @scrypted/types or use @scrypted/client instead', e);
}
exports["default"] = exports.sdk;
//# sourceMappingURL=index.js.map

/***/ },

/***/ "./node_modules/@scrypted/sdk/dist/src/settings-mixin.js"
/*!***************************************************************!*\
  !*** ./node_modules/@scrypted/sdk/dist/src/settings-mixin.js ***!
  \***************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SettingsMixinDeviceBase = void 0;
const _1 = __importStar(__webpack_require__(/*! . */ "./node_modules/@scrypted/sdk/dist/src/index.js"));
const { deviceManager } = _1.default;
class SettingsMixinDeviceBase extends _1.MixinDeviceBase {
    constructor(options) {
        super(options);
        this.settingsGroup = options.group;
        this.settingsGroupKey = options.groupKey;
        process.nextTick(() => deviceManager.onMixinEvent(this.id, this, _1.ScryptedInterface.Settings, null));
    }
    async getSettings() {
        const settingsPromise = this.mixinDeviceInterfaces.includes(_1.ScryptedInterface.Settings) ? this.mixinDevice.getSettings() : undefined;
        const mixinSettingsPromise = this.getMixinSettings();
        const allSettings = [];
        try {
            const settings = (await settingsPromise) || [];
            allSettings.push(...settings);
        }
        catch (e) {
            const name = this.name;
            const description = `${name} Extension settings failed to load.`;
            this.console.error(description, e);
            allSettings.push({
                key: Math.random().toString(),
                title: name,
                value: 'Settings Error',
                group: 'Errors',
                description,
                readonly: true,
            });
        }
        try {
            const mixinSettings = (await mixinSettingsPromise) || [];
            for (const setting of mixinSettings) {
                setting.group = setting.group || this.settingsGroup;
                setting.key = this.settingsGroupKey + ':' + setting.key;
            }
            allSettings.push(...mixinSettings);
        }
        catch (e) {
            const name = deviceManager.getDeviceState(this.mixinProviderNativeId).name;
            const description = `${name} Extension settings failed to load.`;
            this.console.error(description, e);
            allSettings.push({
                key: Math.random().toString(),
                title: name,
                value: 'Settings Error',
                group: 'Errors',
                description,
                readonly: true,
            });
        }
        return allSettings;
    }
    async putSetting(key, value) {
        const prefix = this.settingsGroupKey + ':';
        if (!key?.startsWith(prefix)) {
            return this.mixinDevice.putSetting(key, value);
        }
        if (!await this.putMixinSetting(key.substring(prefix.length), value))
            deviceManager.onMixinEvent(this.id, this, _1.ScryptedInterface.Settings, null);
    }
    async release() {
        await deviceManager.onMixinEvent(this.id, this, _1.ScryptedInterface.Settings, null);
    }
}
exports.SettingsMixinDeviceBase = SettingsMixinDeviceBase;
//# sourceMappingURL=settings-mixin.js.map

/***/ },

/***/ "./node_modules/@scrypted/sdk/dist/src/storage-settings.js"
/*!*****************************************************************!*\
  !*** ./node_modules/@scrypted/sdk/dist/src/storage-settings.js ***!
  \*****************************************************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.StorageSettings = void 0;
const _1 = __importStar(__webpack_require__(/*! . */ "./node_modules/@scrypted/sdk/dist/src/index.js"));
const { systemManager } = _1.default;
function parseValue(value, setting, readDefaultValue, rawDevice) {
    if (value === null || value === undefined) {
        return readDefaultValue();
    }
    const type = setting.multiple ? 'array' : setting.type;
    if (type === 'boolean') {
        if (value === 'true')
            return true;
        if (value === 'false')
            return false;
        return readDefaultValue() || false;
    }
    if (type === 'number') {
        const n = parseFloat(value);
        if (!isNaN(n))
            return n;
        return readDefaultValue() || 0;
    }
    if (type === 'integer') {
        const n = parseInt(value);
        if (!isNaN(n))
            return n;
        return readDefaultValue() || 0;
    }
    if (type === 'array') {
        if (!value)
            return readDefaultValue() || [];
        try {
            return JSON.parse(value);
        }
        catch (e) {
            return readDefaultValue() || [];
        }
    }
    if (type === 'device') {
        if (rawDevice)
            return value;
        return systemManager.getDeviceById(value) || systemManager.getDeviceById(readDefaultValue());
    }
    // string type, so check if it is json.
    if (value && setting.json) {
        try {
            return JSON.parse(value);
        }
        catch (e) {
            return readDefaultValue();
        }
    }
    return value || readDefaultValue();
}
class StorageSettings {
    constructor(device, settings) {
        this.device = device;
        this.settings = settings;
        this.values = {};
        this.hasValue = {};
        for (const key of Object.keys(settings)) {
            const setting = settings[key];
            const rawGet = () => this.getItem(key);
            let get;
            if (setting.type !== 'clippath') {
                get = rawGet;
            }
            else {
                // maybe need a mapPut. clippath is the only complex type at the moment.
                get = () => {
                    try {
                        return JSON.parse(rawGet());
                    }
                    catch (e) {
                    }
                };
            }
            Object.defineProperty(this.values, key, {
                get,
                set: value => this.putSetting(key, value),
                enumerable: true,
            });
            Object.defineProperty(this.hasValue, key, {
                get: () => this.device.storage.getItem(key) != null,
                enumerable: true,
            });
        }
    }
    get keys() {
        const ret = {};
        for (const key of Object.keys(this.settings)) {
            ret[key] = key;
        }
        return ret;
    }
    async getSettings() {
        const onGet = await this.options?.onGet?.();
        const ret = [];
        for (const [key, setting] of Object.entries(this.settings)) {
            let s = Object.assign({}, setting);
            if (onGet?.[key])
                s = Object.assign(s, onGet[key]);
            if (s.onGet)
                s = Object.assign(s, await s.onGet());
            if (s.hide || await this.options?.hide?.[key]?.())
                continue;
            s.key = key;
            s.value = this.getItemInternal(key, s, true);
            if (typeof s.deviceFilter === 'function')
                s.deviceFilter = s.deviceFilter.toString();
            ret.push(s);
            delete s.onPut;
            delete s.onGet;
            delete s.mapPut;
            delete s.mapGet;
        }
        return ret;
    }
    async putSetting(key, value) {
        const setting = this.settings[key];
        let oldValue;
        if (setting)
            oldValue = this.getItemInternal(key, setting);
        return this.putSettingInternal(setting, oldValue, key, value);
    }
    putSettingInternal(setting, oldValue, key, value) {
        if (!setting?.noStore) {
            if (setting?.mapPut)
                value = setting.mapPut(oldValue, value);
            // nullish values should be removed, since Storage can't persist them correctly.
            if (value == null)
                this.device.storage.removeItem(key);
            else if (typeof value === 'object')
                this.device.storage.setItem(key, JSON.stringify(value));
            else
                this.device.storage.setItem(key, value?.toString());
        }
        setting?.onPut?.(oldValue, value);
        if (!setting?.hide)
            this.device.onDeviceEvent(_1.ScryptedInterface.Settings, undefined);
    }
    getItemInternal(key, setting, rawDevice) {
        if (!setting)
            return this.device.storage.getItem(key);
        const readDefaultValue = () => {
            if (setting.persistedDefaultValue != null) {
                this.putSettingInternal(setting, undefined, key, setting.persistedDefaultValue);
                return setting.persistedDefaultValue;
            }
            return setting.defaultValue;
        };
        const ret = parseValue(this.device.storage.getItem(key), setting, readDefaultValue, rawDevice);
        return setting.mapGet ? setting.mapGet(ret) : ret;
    }
    getItem(key) {
        return this.getItemInternal(key, this.settings[key]);
    }
}
exports.StorageSettings = StorageSettings;
//# sourceMappingURL=storage-settings.js.map

/***/ },

/***/ "./node_modules/@scrypted/sdk/dist/src sync recursive"
/*!***************************************************!*\
  !*** ./node_modules/@scrypted/sdk/dist/src/ sync ***!
  \***************************************************/
(module) {

function webpackEmptyContext(req) {
	var e = new Error("Cannot find module '" + req + "'");
	e.code = 'MODULE_NOT_FOUND';
	throw e;
}
webpackEmptyContext.keys = () => ([]);
webpackEmptyContext.resolve = webpackEmptyContext;
webpackEmptyContext.id = "./node_modules/@scrypted/sdk/dist/src sync recursive";
module.exports = webpackEmptyContext;

/***/ },

/***/ "./node_modules/@scrypted/sdk/dist/types/gen/index.js"
/*!************************************************************!*\
  !*** ./node_modules/@scrypted/sdk/dist/types/gen/index.js ***!
  \************************************************************/
(__unused_webpack_module, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ScryptedMimeTypes = exports.ScryptedInterface = exports.MediaPlayerState = exports.SecuritySystemObstruction = exports.SecuritySystemMode = exports.AirQuality = exports.AirPurifierMode = exports.AirPurifierStatus = exports.ChargeState = exports.LockState = exports.PanTiltZoomMovement = exports.ThermostatMode = exports.TemperatureUnit = exports.FanMode = exports.HumidityMode = exports.ScryptedDeviceType = exports.ScryptedInterfaceDescriptors = exports.ScryptedInterfaceMethod = exports.ScryptedInterfaceProperty = exports.DeviceBase = exports.TYPES_VERSION = void 0;
exports.TYPES_VERSION = "0.5.49";
class DeviceBase {
}
exports.DeviceBase = DeviceBase;
var ScryptedInterfaceProperty;
(function (ScryptedInterfaceProperty) {
    ScryptedInterfaceProperty["id"] = "id";
    ScryptedInterfaceProperty["info"] = "info";
    ScryptedInterfaceProperty["interfaces"] = "interfaces";
    ScryptedInterfaceProperty["mixins"] = "mixins";
    ScryptedInterfaceProperty["name"] = "name";
    ScryptedInterfaceProperty["nativeId"] = "nativeId";
    ScryptedInterfaceProperty["pluginId"] = "pluginId";
    ScryptedInterfaceProperty["providedInterfaces"] = "providedInterfaces";
    ScryptedInterfaceProperty["providedName"] = "providedName";
    ScryptedInterfaceProperty["providedRoom"] = "providedRoom";
    ScryptedInterfaceProperty["providedType"] = "providedType";
    ScryptedInterfaceProperty["providerId"] = "providerId";
    ScryptedInterfaceProperty["room"] = "room";
    ScryptedInterfaceProperty["type"] = "type";
    ScryptedInterfaceProperty["scryptedRuntimeArguments"] = "scryptedRuntimeArguments";
    ScryptedInterfaceProperty["on"] = "on";
    ScryptedInterfaceProperty["brightness"] = "brightness";
    ScryptedInterfaceProperty["colorTemperature"] = "colorTemperature";
    ScryptedInterfaceProperty["rgb"] = "rgb";
    ScryptedInterfaceProperty["hsv"] = "hsv";
    ScryptedInterfaceProperty["buttons"] = "buttons";
    ScryptedInterfaceProperty["sensors"] = "sensors";
    ScryptedInterfaceProperty["running"] = "running";
    ScryptedInterfaceProperty["paused"] = "paused";
    ScryptedInterfaceProperty["docked"] = "docked";
    ScryptedInterfaceProperty["temperatureSetting"] = "temperatureSetting";
    ScryptedInterfaceProperty["temperature"] = "temperature";
    ScryptedInterfaceProperty["temperatureUnit"] = "temperatureUnit";
    ScryptedInterfaceProperty["humidity"] = "humidity";
    ScryptedInterfaceProperty["resolution"] = "resolution";
    ScryptedInterfaceProperty["audioVolumes"] = "audioVolumes";
    ScryptedInterfaceProperty["recordingActive"] = "recordingActive";
    ScryptedInterfaceProperty["ptzCapabilities"] = "ptzCapabilities";
    ScryptedInterfaceProperty["lockState"] = "lockState";
    ScryptedInterfaceProperty["entryOpen"] = "entryOpen";
    ScryptedInterfaceProperty["batteryLevel"] = "batteryLevel";
    ScryptedInterfaceProperty["chargeState"] = "chargeState";
    ScryptedInterfaceProperty["online"] = "online";
    ScryptedInterfaceProperty["fromMimeType"] = "fromMimeType";
    ScryptedInterfaceProperty["toMimeType"] = "toMimeType";
    ScryptedInterfaceProperty["converters"] = "converters";
    ScryptedInterfaceProperty["binaryState"] = "binaryState";
    ScryptedInterfaceProperty["tampered"] = "tampered";
    ScryptedInterfaceProperty["sleeping"] = "sleeping";
    ScryptedInterfaceProperty["powerDetected"] = "powerDetected";
    ScryptedInterfaceProperty["audioDetected"] = "audioDetected";
    ScryptedInterfaceProperty["motionDetected"] = "motionDetected";
    ScryptedInterfaceProperty["ambientLight"] = "ambientLight";
    ScryptedInterfaceProperty["occupied"] = "occupied";
    ScryptedInterfaceProperty["flooded"] = "flooded";
    ScryptedInterfaceProperty["ultraviolet"] = "ultraviolet";
    ScryptedInterfaceProperty["luminance"] = "luminance";
    ScryptedInterfaceProperty["position"] = "position";
    ScryptedInterfaceProperty["securitySystemState"] = "securitySystemState";
    ScryptedInterfaceProperty["pm10Density"] = "pm10Density";
    ScryptedInterfaceProperty["pm25Density"] = "pm25Density";
    ScryptedInterfaceProperty["vocDensity"] = "vocDensity";
    ScryptedInterfaceProperty["noxDensity"] = "noxDensity";
    ScryptedInterfaceProperty["co2ppm"] = "co2ppm";
    ScryptedInterfaceProperty["airQuality"] = "airQuality";
    ScryptedInterfaceProperty["airPurifierState"] = "airPurifierState";
    ScryptedInterfaceProperty["filterChangeIndication"] = "filterChangeIndication";
    ScryptedInterfaceProperty["filterLifeLevel"] = "filterLifeLevel";
    ScryptedInterfaceProperty["humiditySetting"] = "humiditySetting";
    ScryptedInterfaceProperty["fan"] = "fan";
    ScryptedInterfaceProperty["applicationInfo"] = "applicationInfo";
    ScryptedInterfaceProperty["chatCompletionCapabilities"] = "chatCompletionCapabilities";
    ScryptedInterfaceProperty["systemDevice"] = "systemDevice";
})(ScryptedInterfaceProperty || (exports.ScryptedInterfaceProperty = ScryptedInterfaceProperty = {}));
var ScryptedInterfaceMethod;
(function (ScryptedInterfaceMethod) {
    ScryptedInterfaceMethod["listen"] = "listen";
    ScryptedInterfaceMethod["probe"] = "probe";
    ScryptedInterfaceMethod["setMixins"] = "setMixins";
    ScryptedInterfaceMethod["setName"] = "setName";
    ScryptedInterfaceMethod["setRoom"] = "setRoom";
    ScryptedInterfaceMethod["setType"] = "setType";
    ScryptedInterfaceMethod["getPluginJson"] = "getPluginJson";
    ScryptedInterfaceMethod["turnOff"] = "turnOff";
    ScryptedInterfaceMethod["turnOn"] = "turnOn";
    ScryptedInterfaceMethod["setBrightness"] = "setBrightness";
    ScryptedInterfaceMethod["getTemperatureMaxK"] = "getTemperatureMaxK";
    ScryptedInterfaceMethod["getTemperatureMinK"] = "getTemperatureMinK";
    ScryptedInterfaceMethod["setColorTemperature"] = "setColorTemperature";
    ScryptedInterfaceMethod["setRgb"] = "setRgb";
    ScryptedInterfaceMethod["setHsv"] = "setHsv";
    ScryptedInterfaceMethod["pressButton"] = "pressButton";
    ScryptedInterfaceMethod["sendNotification"] = "sendNotification";
    ScryptedInterfaceMethod["start"] = "start";
    ScryptedInterfaceMethod["stop"] = "stop";
    ScryptedInterfaceMethod["pause"] = "pause";
    ScryptedInterfaceMethod["resume"] = "resume";
    ScryptedInterfaceMethod["dock"] = "dock";
    ScryptedInterfaceMethod["setTemperature"] = "setTemperature";
    ScryptedInterfaceMethod["setTemperatureUnit"] = "setTemperatureUnit";
    ScryptedInterfaceMethod["getPictureOptions"] = "getPictureOptions";
    ScryptedInterfaceMethod["takePicture"] = "takePicture";
    ScryptedInterfaceMethod["getAudioStream"] = "getAudioStream";
    ScryptedInterfaceMethod["setAudioVolumes"] = "setAudioVolumes";
    ScryptedInterfaceMethod["startDisplay"] = "startDisplay";
    ScryptedInterfaceMethod["stopDisplay"] = "stopDisplay";
    ScryptedInterfaceMethod["getVideoStream"] = "getVideoStream";
    ScryptedInterfaceMethod["getVideoStreamOptions"] = "getVideoStreamOptions";
    ScryptedInterfaceMethod["getPrivacyMasks"] = "getPrivacyMasks";
    ScryptedInterfaceMethod["setPrivacyMasks"] = "setPrivacyMasks";
    ScryptedInterfaceMethod["getVideoTextOverlays"] = "getVideoTextOverlays";
    ScryptedInterfaceMethod["setVideoTextOverlay"] = "setVideoTextOverlay";
    ScryptedInterfaceMethod["getRecordingStream"] = "getRecordingStream";
    ScryptedInterfaceMethod["getRecordingStreamCurrentTime"] = "getRecordingStreamCurrentTime";
    ScryptedInterfaceMethod["getRecordingStreamOptions"] = "getRecordingStreamOptions";
    ScryptedInterfaceMethod["getRecordingStreamThumbnail"] = "getRecordingStreamThumbnail";
    ScryptedInterfaceMethod["deleteRecordingStream"] = "deleteRecordingStream";
    ScryptedInterfaceMethod["setRecordingActive"] = "setRecordingActive";
    ScryptedInterfaceMethod["ptzCommand"] = "ptzCommand";
    ScryptedInterfaceMethod["getRecordedEvents"] = "getRecordedEvents";
    ScryptedInterfaceMethod["getVideoClip"] = "getVideoClip";
    ScryptedInterfaceMethod["getVideoClips"] = "getVideoClips";
    ScryptedInterfaceMethod["getVideoClipThumbnail"] = "getVideoClipThumbnail";
    ScryptedInterfaceMethod["removeVideoClips"] = "removeVideoClips";
    ScryptedInterfaceMethod["setVideoStreamOptions"] = "setVideoStreamOptions";
    ScryptedInterfaceMethod["startIntercom"] = "startIntercom";
    ScryptedInterfaceMethod["stopIntercom"] = "stopIntercom";
    ScryptedInterfaceMethod["lock"] = "lock";
    ScryptedInterfaceMethod["unlock"] = "unlock";
    ScryptedInterfaceMethod["addPassword"] = "addPassword";
    ScryptedInterfaceMethod["getPasswords"] = "getPasswords";
    ScryptedInterfaceMethod["removePassword"] = "removePassword";
    ScryptedInterfaceMethod["activate"] = "activate";
    ScryptedInterfaceMethod["deactivate"] = "deactivate";
    ScryptedInterfaceMethod["isReversible"] = "isReversible";
    ScryptedInterfaceMethod["closeEntry"] = "closeEntry";
    ScryptedInterfaceMethod["openEntry"] = "openEntry";
    ScryptedInterfaceMethod["getDevice"] = "getDevice";
    ScryptedInterfaceMethod["releaseDevice"] = "releaseDevice";
    ScryptedInterfaceMethod["adoptDevice"] = "adoptDevice";
    ScryptedInterfaceMethod["discoverDevices"] = "discoverDevices";
    ScryptedInterfaceMethod["createDevice"] = "createDevice";
    ScryptedInterfaceMethod["getCreateDeviceSettings"] = "getCreateDeviceSettings";
    ScryptedInterfaceMethod["reboot"] = "reboot";
    ScryptedInterfaceMethod["getRefreshFrequency"] = "getRefreshFrequency";
    ScryptedInterfaceMethod["refresh"] = "refresh";
    ScryptedInterfaceMethod["getMediaStatus"] = "getMediaStatus";
    ScryptedInterfaceMethod["load"] = "load";
    ScryptedInterfaceMethod["seek"] = "seek";
    ScryptedInterfaceMethod["skipNext"] = "skipNext";
    ScryptedInterfaceMethod["skipPrevious"] = "skipPrevious";
    ScryptedInterfaceMethod["convert"] = "convert";
    ScryptedInterfaceMethod["convertMedia"] = "convertMedia";
    ScryptedInterfaceMethod["getSettings"] = "getSettings";
    ScryptedInterfaceMethod["putSetting"] = "putSetting";
    ScryptedInterfaceMethod["armSecuritySystem"] = "armSecuritySystem";
    ScryptedInterfaceMethod["disarmSecuritySystem"] = "disarmSecuritySystem";
    ScryptedInterfaceMethod["setAirPurifierState"] = "setAirPurifierState";
    ScryptedInterfaceMethod["getReadmeMarkdown"] = "getReadmeMarkdown";
    ScryptedInterfaceMethod["getOauthUrl"] = "getOauthUrl";
    ScryptedInterfaceMethod["onOauthCallback"] = "onOauthCallback";
    ScryptedInterfaceMethod["canMixin"] = "canMixin";
    ScryptedInterfaceMethod["getMixin"] = "getMixin";
    ScryptedInterfaceMethod["releaseMixin"] = "releaseMixin";
    ScryptedInterfaceMethod["onRequest"] = "onRequest";
    ScryptedInterfaceMethod["onConnection"] = "onConnection";
    ScryptedInterfaceMethod["onPush"] = "onPush";
    ScryptedInterfaceMethod["run"] = "run";
    ScryptedInterfaceMethod["eval"] = "eval";
    ScryptedInterfaceMethod["loadScripts"] = "loadScripts";
    ScryptedInterfaceMethod["saveScript"] = "saveScript";
    ScryptedInterfaceMethod["forkInterface"] = "forkInterface";
    ScryptedInterfaceMethod["getDetectionInput"] = "getDetectionInput";
    ScryptedInterfaceMethod["getObjectTypes"] = "getObjectTypes";
    ScryptedInterfaceMethod["detectObjects"] = "detectObjects";
    ScryptedInterfaceMethod["generateObjectDetections"] = "generateObjectDetections";
    ScryptedInterfaceMethod["getDetectionModel"] = "getDetectionModel";
    ScryptedInterfaceMethod["setHumidity"] = "setHumidity";
    ScryptedInterfaceMethod["setFan"] = "setFan";
    ScryptedInterfaceMethod["startRTCSignalingSession"] = "startRTCSignalingSession";
    ScryptedInterfaceMethod["createRTCSignalingSession"] = "createRTCSignalingSession";
    ScryptedInterfaceMethod["getScryptedUserAccessControl"] = "getScryptedUserAccessControl";
    ScryptedInterfaceMethod["generateVideoFrames"] = "generateVideoFrames";
    ScryptedInterfaceMethod["connectStream"] = "connectStream";
    ScryptedInterfaceMethod["getTTYSettings"] = "getTTYSettings";
    ScryptedInterfaceMethod["getChatCompletion"] = "getChatCompletion";
    ScryptedInterfaceMethod["streamChatCompletion"] = "streamChatCompletion";
    ScryptedInterfaceMethod["getTextEmbedding"] = "getTextEmbedding";
    ScryptedInterfaceMethod["getImageEmbedding"] = "getImageEmbedding";
    ScryptedInterfaceMethod["callLLMTool"] = "callLLMTool";
    ScryptedInterfaceMethod["getLLMTools"] = "getLLMTools";
})(ScryptedInterfaceMethod || (exports.ScryptedInterfaceMethod = ScryptedInterfaceMethod = {}));
exports.ScryptedInterfaceDescriptors = {
    "ScryptedDevice": {
        "name": "ScryptedDevice",
        "methods": [
            "listen",
            "probe",
            "setMixins",
            "setName",
            "setRoom",
            "setType"
        ],
        "properties": [
            "id",
            "info",
            "interfaces",
            "mixins",
            "name",
            "nativeId",
            "pluginId",
            "providedInterfaces",
            "providedName",
            "providedRoom",
            "providedType",
            "providerId",
            "room",
            "type"
        ]
    },
    "ScryptedPlugin": {
        "name": "ScryptedPlugin",
        "methods": [
            "getPluginJson"
        ],
        "properties": []
    },
    "ScryptedPluginRuntime": {
        "name": "ScryptedPluginRuntime",
        "methods": [],
        "properties": [
            "scryptedRuntimeArguments"
        ]
    },
    "OnOff": {
        "name": "OnOff",
        "methods": [
            "turnOff",
            "turnOn"
        ],
        "properties": [
            "on"
        ]
    },
    "Brightness": {
        "name": "Brightness",
        "methods": [
            "setBrightness"
        ],
        "properties": [
            "brightness"
        ]
    },
    "ColorSettingTemperature": {
        "name": "ColorSettingTemperature",
        "methods": [
            "getTemperatureMaxK",
            "getTemperatureMinK",
            "setColorTemperature"
        ],
        "properties": [
            "colorTemperature"
        ]
    },
    "ColorSettingRgb": {
        "name": "ColorSettingRgb",
        "methods": [
            "setRgb"
        ],
        "properties": [
            "rgb"
        ]
    },
    "ColorSettingHsv": {
        "name": "ColorSettingHsv",
        "methods": [
            "setHsv"
        ],
        "properties": [
            "hsv"
        ]
    },
    "Buttons": {
        "name": "Buttons",
        "methods": [],
        "properties": [
            "buttons"
        ]
    },
    "PressButtons": {
        "name": "PressButtons",
        "methods": [
            "pressButton"
        ],
        "properties": []
    },
    "Sensors": {
        "name": "Sensors",
        "methods": [],
        "properties": [
            "sensors"
        ]
    },
    "Notifier": {
        "name": "Notifier",
        "methods": [
            "sendNotification"
        ],
        "properties": []
    },
    "StartStop": {
        "name": "StartStop",
        "methods": [
            "start",
            "stop"
        ],
        "properties": [
            "running"
        ]
    },
    "Pause": {
        "name": "Pause",
        "methods": [
            "pause",
            "resume"
        ],
        "properties": [
            "paused"
        ]
    },
    "Dock": {
        "name": "Dock",
        "methods": [
            "dock"
        ],
        "properties": [
            "docked"
        ]
    },
    "TemperatureSetting": {
        "name": "TemperatureSetting",
        "methods": [
            "setTemperature"
        ],
        "properties": [
            "temperatureSetting"
        ]
    },
    "Thermometer": {
        "name": "Thermometer",
        "methods": [
            "setTemperatureUnit"
        ],
        "properties": [
            "temperature",
            "temperatureUnit"
        ]
    },
    "HumiditySensor": {
        "name": "HumiditySensor",
        "methods": [],
        "properties": [
            "humidity"
        ]
    },
    "Camera": {
        "name": "Camera",
        "methods": [
            "getPictureOptions",
            "takePicture"
        ],
        "properties": []
    },
    "Resolution": {
        "name": "Resolution",
        "methods": [],
        "properties": [
            "resolution"
        ]
    },
    "Microphone": {
        "name": "Microphone",
        "methods": [
            "getAudioStream"
        ],
        "properties": []
    },
    "AudioVolumeControl": {
        "name": "AudioVolumeControl",
        "methods": [
            "setAudioVolumes"
        ],
        "properties": [
            "audioVolumes"
        ]
    },
    "Display": {
        "name": "Display",
        "methods": [
            "startDisplay",
            "stopDisplay"
        ],
        "properties": []
    },
    "VideoCamera": {
        "name": "VideoCamera",
        "methods": [
            "getVideoStream",
            "getVideoStreamOptions"
        ],
        "properties": []
    },
    "VideoCameraMask": {
        "name": "VideoCameraMask",
        "methods": [
            "getPrivacyMasks",
            "setPrivacyMasks"
        ],
        "properties": []
    },
    "VideoTextOverlays": {
        "name": "VideoTextOverlays",
        "methods": [
            "getVideoTextOverlays",
            "setVideoTextOverlay"
        ],
        "properties": []
    },
    "VideoRecorder": {
        "name": "VideoRecorder",
        "methods": [
            "getRecordingStream",
            "getRecordingStreamCurrentTime",
            "getRecordingStreamOptions",
            "getRecordingStreamThumbnail"
        ],
        "properties": [
            "recordingActive"
        ]
    },
    "VideoRecorderManagement": {
        "name": "VideoRecorderManagement",
        "methods": [
            "deleteRecordingStream",
            "setRecordingActive"
        ],
        "properties": []
    },
    "PanTiltZoom": {
        "name": "PanTiltZoom",
        "methods": [
            "ptzCommand"
        ],
        "properties": [
            "ptzCapabilities"
        ]
    },
    "EventRecorder": {
        "name": "EventRecorder",
        "methods": [
            "getRecordedEvents"
        ],
        "properties": []
    },
    "VideoClips": {
        "name": "VideoClips",
        "methods": [
            "getVideoClip",
            "getVideoClips",
            "getVideoClipThumbnail",
            "removeVideoClips"
        ],
        "properties": []
    },
    "VideoCameraConfiguration": {
        "name": "VideoCameraConfiguration",
        "methods": [
            "setVideoStreamOptions"
        ],
        "properties": []
    },
    "Intercom": {
        "name": "Intercom",
        "methods": [
            "startIntercom",
            "stopIntercom"
        ],
        "properties": []
    },
    "Lock": {
        "name": "Lock",
        "methods": [
            "lock",
            "unlock"
        ],
        "properties": [
            "lockState"
        ]
    },
    "PasswordStore": {
        "name": "PasswordStore",
        "methods": [
            "addPassword",
            "getPasswords",
            "removePassword"
        ],
        "properties": []
    },
    "Scene": {
        "name": "Scene",
        "methods": [
            "activate",
            "deactivate",
            "isReversible"
        ],
        "properties": []
    },
    "Entry": {
        "name": "Entry",
        "methods": [
            "closeEntry",
            "openEntry"
        ],
        "properties": []
    },
    "EntrySensor": {
        "name": "EntrySensor",
        "methods": [],
        "properties": [
            "entryOpen"
        ]
    },
    "DeviceProvider": {
        "name": "DeviceProvider",
        "methods": [
            "getDevice",
            "releaseDevice"
        ],
        "properties": []
    },
    "DeviceDiscovery": {
        "name": "DeviceDiscovery",
        "methods": [
            "adoptDevice",
            "discoverDevices"
        ],
        "properties": []
    },
    "DeviceCreator": {
        "name": "DeviceCreator",
        "methods": [
            "createDevice",
            "getCreateDeviceSettings"
        ],
        "properties": []
    },
    "Battery": {
        "name": "Battery",
        "methods": [],
        "properties": [
            "batteryLevel"
        ]
    },
    "Charger": {
        "name": "Charger",
        "methods": [],
        "properties": [
            "chargeState"
        ]
    },
    "Reboot": {
        "name": "Reboot",
        "methods": [
            "reboot"
        ],
        "properties": []
    },
    "Refresh": {
        "name": "Refresh",
        "methods": [
            "getRefreshFrequency",
            "refresh"
        ],
        "properties": []
    },
    "MediaPlayer": {
        "name": "MediaPlayer",
        "methods": [
            "getMediaStatus",
            "load",
            "seek",
            "skipNext",
            "skipPrevious"
        ],
        "properties": []
    },
    "Online": {
        "name": "Online",
        "methods": [],
        "properties": [
            "online"
        ]
    },
    "BufferConverter": {
        "name": "BufferConverter",
        "methods": [
            "convert"
        ],
        "properties": [
            "fromMimeType",
            "toMimeType"
        ]
    },
    "MediaConverter": {
        "name": "MediaConverter",
        "methods": [
            "convertMedia"
        ],
        "properties": [
            "converters"
        ]
    },
    "Settings": {
        "name": "Settings",
        "methods": [
            "getSettings",
            "putSetting"
        ],
        "properties": []
    },
    "BinarySensor": {
        "name": "BinarySensor",
        "methods": [],
        "properties": [
            "binaryState"
        ]
    },
    "TamperSensor": {
        "name": "TamperSensor",
        "methods": [],
        "properties": [
            "tampered"
        ]
    },
    "Sleep": {
        "name": "Sleep",
        "methods": [],
        "properties": [
            "sleeping"
        ]
    },
    "PowerSensor": {
        "name": "PowerSensor",
        "methods": [],
        "properties": [
            "powerDetected"
        ]
    },
    "AudioSensor": {
        "name": "AudioSensor",
        "methods": [],
        "properties": [
            "audioDetected"
        ]
    },
    "MotionSensor": {
        "name": "MotionSensor",
        "methods": [],
        "properties": [
            "motionDetected"
        ]
    },
    "AmbientLightSensor": {
        "name": "AmbientLightSensor",
        "methods": [],
        "properties": [
            "ambientLight"
        ]
    },
    "OccupancySensor": {
        "name": "OccupancySensor",
        "methods": [],
        "properties": [
            "occupied"
        ]
    },
    "FloodSensor": {
        "name": "FloodSensor",
        "methods": [],
        "properties": [
            "flooded"
        ]
    },
    "UltravioletSensor": {
        "name": "UltravioletSensor",
        "methods": [],
        "properties": [
            "ultraviolet"
        ]
    },
    "LuminanceSensor": {
        "name": "LuminanceSensor",
        "methods": [],
        "properties": [
            "luminance"
        ]
    },
    "PositionSensor": {
        "name": "PositionSensor",
        "methods": [],
        "properties": [
            "position"
        ]
    },
    "SecuritySystem": {
        "name": "SecuritySystem",
        "methods": [
            "armSecuritySystem",
            "disarmSecuritySystem"
        ],
        "properties": [
            "securitySystemState"
        ]
    },
    "PM10Sensor": {
        "name": "PM10Sensor",
        "methods": [],
        "properties": [
            "pm10Density"
        ]
    },
    "PM25Sensor": {
        "name": "PM25Sensor",
        "methods": [],
        "properties": [
            "pm25Density"
        ]
    },
    "VOCSensor": {
        "name": "VOCSensor",
        "methods": [],
        "properties": [
            "vocDensity"
        ]
    },
    "NOXSensor": {
        "name": "NOXSensor",
        "methods": [],
        "properties": [
            "noxDensity"
        ]
    },
    "CO2Sensor": {
        "name": "CO2Sensor",
        "methods": [],
        "properties": [
            "co2ppm"
        ]
    },
    "AirQualitySensor": {
        "name": "AirQualitySensor",
        "methods": [],
        "properties": [
            "airQuality"
        ]
    },
    "AirPurifier": {
        "name": "AirPurifier",
        "methods": [
            "setAirPurifierState"
        ],
        "properties": [
            "airPurifierState"
        ]
    },
    "FilterMaintenance": {
        "name": "FilterMaintenance",
        "methods": [],
        "properties": [
            "filterChangeIndication",
            "filterLifeLevel"
        ]
    },
    "Readme": {
        "name": "Readme",
        "methods": [
            "getReadmeMarkdown"
        ],
        "properties": []
    },
    "OauthClient": {
        "name": "OauthClient",
        "methods": [
            "getOauthUrl",
            "onOauthCallback"
        ],
        "properties": []
    },
    "MixinProvider": {
        "name": "MixinProvider",
        "methods": [
            "canMixin",
            "getMixin",
            "releaseMixin"
        ],
        "properties": []
    },
    "HttpRequestHandler": {
        "name": "HttpRequestHandler",
        "methods": [
            "onRequest"
        ],
        "properties": []
    },
    "EngineIOHandler": {
        "name": "EngineIOHandler",
        "methods": [
            "onConnection"
        ],
        "properties": []
    },
    "PushHandler": {
        "name": "PushHandler",
        "methods": [
            "onPush"
        ],
        "properties": []
    },
    "Program": {
        "name": "Program",
        "methods": [
            "run"
        ],
        "properties": []
    },
    "Scriptable": {
        "name": "Scriptable",
        "methods": [
            "eval",
            "loadScripts",
            "saveScript"
        ],
        "properties": []
    },
    "ClusterForkInterface": {
        "name": "ClusterForkInterface",
        "methods": [
            "forkInterface"
        ],
        "properties": []
    },
    "ObjectDetector": {
        "name": "ObjectDetector",
        "methods": [
            "getDetectionInput",
            "getObjectTypes"
        ],
        "properties": []
    },
    "ObjectDetection": {
        "name": "ObjectDetection",
        "methods": [
            "detectObjects",
            "generateObjectDetections",
            "getDetectionModel"
        ],
        "properties": []
    },
    "ObjectDetectionPreview": {
        "name": "ObjectDetectionPreview",
        "methods": [],
        "properties": []
    },
    "ObjectDetectionGenerator": {
        "name": "ObjectDetectionGenerator",
        "methods": [],
        "properties": []
    },
    "HumiditySetting": {
        "name": "HumiditySetting",
        "methods": [
            "setHumidity"
        ],
        "properties": [
            "humiditySetting"
        ]
    },
    "Fan": {
        "name": "Fan",
        "methods": [
            "setFan"
        ],
        "properties": [
            "fan"
        ]
    },
    "RTCSignalingChannel": {
        "name": "RTCSignalingChannel",
        "methods": [
            "startRTCSignalingSession"
        ],
        "properties": []
    },
    "RTCSignalingClient": {
        "name": "RTCSignalingClient",
        "methods": [
            "createRTCSignalingSession"
        ],
        "properties": []
    },
    "LauncherApplication": {
        "name": "LauncherApplication",
        "methods": [],
        "properties": [
            "applicationInfo"
        ]
    },
    "ScryptedUser": {
        "name": "ScryptedUser",
        "methods": [
            "getScryptedUserAccessControl"
        ],
        "properties": []
    },
    "VideoFrameGenerator": {
        "name": "VideoFrameGenerator",
        "methods": [
            "generateVideoFrames"
        ],
        "properties": []
    },
    "StreamService": {
        "name": "StreamService",
        "methods": [
            "connectStream"
        ],
        "properties": []
    },
    "TTY": {
        "name": "TTY",
        "methods": [],
        "properties": []
    },
    "TTYSettings": {
        "name": "TTYSettings",
        "methods": [
            "getTTYSettings"
        ],
        "properties": []
    },
    "ChatCompletion": {
        "name": "ChatCompletion",
        "methods": [
            "getChatCompletion",
            "streamChatCompletion"
        ],
        "properties": [
            "chatCompletionCapabilities"
        ]
    },
    "TextEmbedding": {
        "name": "TextEmbedding",
        "methods": [
            "getTextEmbedding"
        ],
        "properties": []
    },
    "ImageEmbedding": {
        "name": "ImageEmbedding",
        "methods": [
            "getImageEmbedding"
        ],
        "properties": []
    },
    "LLMTools": {
        "name": "LLMTools",
        "methods": [
            "callLLMTool",
            "getLLMTools"
        ],
        "properties": []
    },
    "ScryptedSystemDevice": {
        "name": "ScryptedSystemDevice",
        "methods": [],
        "properties": [
            "systemDevice"
        ]
    },
    "ScryptedDeviceCreator": {
        "name": "ScryptedDeviceCreator",
        "methods": [],
        "properties": []
    },
    "ScryptedSettings": {
        "name": "ScryptedSettings",
        "methods": [],
        "properties": []
    }
};
/**
 * @category Core Reference
 */
var ScryptedDeviceType;
(function (ScryptedDeviceType) {
    /**
     * @deprecated
     */
    ScryptedDeviceType["Builtin"] = "Builtin";
    /**
     * Internal devices will not show up in device lists unless explicitly searched.
     */
    ScryptedDeviceType["Internal"] = "Internal";
    ScryptedDeviceType["Camera"] = "Camera";
    ScryptedDeviceType["Fan"] = "Fan";
    ScryptedDeviceType["Light"] = "Light";
    ScryptedDeviceType["Switch"] = "Switch";
    ScryptedDeviceType["Outlet"] = "Outlet";
    ScryptedDeviceType["Sensor"] = "Sensor";
    ScryptedDeviceType["Scene"] = "Scene";
    ScryptedDeviceType["Program"] = "Program";
    ScryptedDeviceType["Automation"] = "Automation";
    ScryptedDeviceType["Vacuum"] = "Vacuum";
    ScryptedDeviceType["Notifier"] = "Notifier";
    ScryptedDeviceType["Thermostat"] = "Thermostat";
    ScryptedDeviceType["Lock"] = "Lock";
    ScryptedDeviceType["PasswordControl"] = "PasswordControl";
    /**
     * Displays have audio and video output.
     */
    ScryptedDeviceType["Display"] = "Display";
    /**
     * Smart Displays have two way audio and video.
     */
    ScryptedDeviceType["SmartDisplay"] = "SmartDisplay";
    ScryptedDeviceType["Speaker"] = "Speaker";
    /**
     * Smart Speakers have two way audio.
     */
    ScryptedDeviceType["SmartSpeaker"] = "SmartSpeaker";
    ScryptedDeviceType["RemoteDesktop"] = "RemoteDesktop";
    ScryptedDeviceType["Event"] = "Event";
    ScryptedDeviceType["Entry"] = "Entry";
    ScryptedDeviceType["Garage"] = "Garage";
    ScryptedDeviceType["DeviceProvider"] = "DeviceProvider";
    ScryptedDeviceType["DataSource"] = "DataSource";
    ScryptedDeviceType["API"] = "API";
    ScryptedDeviceType["Buttons"] = "Buttons";
    ScryptedDeviceType["Doorbell"] = "Doorbell";
    ScryptedDeviceType["Irrigation"] = "Irrigation";
    ScryptedDeviceType["Valve"] = "Valve";
    ScryptedDeviceType["Person"] = "Person";
    ScryptedDeviceType["SecuritySystem"] = "SecuritySystem";
    ScryptedDeviceType["WindowCovering"] = "WindowCovering";
    ScryptedDeviceType["Siren"] = "Siren";
    ScryptedDeviceType["AirPurifier"] = "AirPurifier";
    ScryptedDeviceType["Internet"] = "Internet";
    ScryptedDeviceType["Network"] = "Network";
    ScryptedDeviceType["Bridge"] = "Bridge";
    ScryptedDeviceType["LLM"] = "LLM";
    ScryptedDeviceType["Unknown"] = "Unknown";
})(ScryptedDeviceType || (exports.ScryptedDeviceType = ScryptedDeviceType = {}));
var HumidityMode;
(function (HumidityMode) {
    HumidityMode["Humidify"] = "Humidify";
    HumidityMode["Dehumidify"] = "Dehumidify";
    HumidityMode["Auto"] = "Auto";
    HumidityMode["Off"] = "Off";
})(HumidityMode || (exports.HumidityMode = HumidityMode = {}));
var FanMode;
(function (FanMode) {
    FanMode["Auto"] = "Auto";
    FanMode["Manual"] = "Manual";
})(FanMode || (exports.FanMode = FanMode = {}));
var TemperatureUnit;
(function (TemperatureUnit) {
    TemperatureUnit["C"] = "C";
    TemperatureUnit["F"] = "F";
})(TemperatureUnit || (exports.TemperatureUnit = TemperatureUnit = {}));
var ThermostatMode;
(function (ThermostatMode) {
    ThermostatMode["Off"] = "Off";
    ThermostatMode["Cool"] = "Cool";
    ThermostatMode["Heat"] = "Heat";
    ThermostatMode["HeatCool"] = "HeatCool";
    ThermostatMode["Auto"] = "Auto";
    ThermostatMode["FanOnly"] = "FanOnly";
    ThermostatMode["Purifier"] = "Purifier";
    ThermostatMode["Eco"] = "Eco";
    ThermostatMode["Dry"] = "Dry";
    ThermostatMode["On"] = "On";
})(ThermostatMode || (exports.ThermostatMode = ThermostatMode = {}));
var PanTiltZoomMovement;
(function (PanTiltZoomMovement) {
    PanTiltZoomMovement["Absolute"] = "Absolute";
    PanTiltZoomMovement["Relative"] = "Relative";
    PanTiltZoomMovement["Continuous"] = "Continuous";
    PanTiltZoomMovement["Preset"] = "Preset";
    PanTiltZoomMovement["Home"] = "Home";
})(PanTiltZoomMovement || (exports.PanTiltZoomMovement = PanTiltZoomMovement = {}));
var LockState;
(function (LockState) {
    LockState["Locked"] = "Locked";
    LockState["Unlocked"] = "Unlocked";
    LockState["Jammed"] = "Jammed";
})(LockState || (exports.LockState = LockState = {}));
var ChargeState;
(function (ChargeState) {
    ChargeState["Trickle"] = "trickle";
    ChargeState["Charging"] = "charging";
    ChargeState["NotCharging"] = "not-charging";
})(ChargeState || (exports.ChargeState = ChargeState = {}));
var AirPurifierStatus;
(function (AirPurifierStatus) {
    AirPurifierStatus["Inactive"] = "Inactive";
    AirPurifierStatus["Idle"] = "Idle";
    AirPurifierStatus["Active"] = "Active";
    AirPurifierStatus["ActiveNightMode"] = "ActiveNightMode";
})(AirPurifierStatus || (exports.AirPurifierStatus = AirPurifierStatus = {}));
var AirPurifierMode;
(function (AirPurifierMode) {
    AirPurifierMode["Manual"] = "Manual";
    AirPurifierMode["Automatic"] = "Automatic";
})(AirPurifierMode || (exports.AirPurifierMode = AirPurifierMode = {}));
var AirQuality;
(function (AirQuality) {
    AirQuality["Unknown"] = "Unknown";
    AirQuality["Excellent"] = "Excellent";
    AirQuality["Good"] = "Good";
    AirQuality["Fair"] = "Fair";
    AirQuality["Inferior"] = "Inferior";
    AirQuality["Poor"] = "Poor";
})(AirQuality || (exports.AirQuality = AirQuality = {}));
var SecuritySystemMode;
(function (SecuritySystemMode) {
    SecuritySystemMode["Disarmed"] = "Disarmed";
    SecuritySystemMode["HomeArmed"] = "HomeArmed";
    SecuritySystemMode["AwayArmed"] = "AwayArmed";
    SecuritySystemMode["NightArmed"] = "NightArmed";
})(SecuritySystemMode || (exports.SecuritySystemMode = SecuritySystemMode = {}));
var SecuritySystemObstruction;
(function (SecuritySystemObstruction) {
    SecuritySystemObstruction["Sensor"] = "Sensor";
    SecuritySystemObstruction["Occupied"] = "Occupied";
    SecuritySystemObstruction["Time"] = "Time";
    SecuritySystemObstruction["Error"] = "Error";
})(SecuritySystemObstruction || (exports.SecuritySystemObstruction = SecuritySystemObstruction = {}));
var MediaPlayerState;
(function (MediaPlayerState) {
    MediaPlayerState["Idle"] = "Idle";
    MediaPlayerState["Playing"] = "Playing";
    MediaPlayerState["Paused"] = "Paused";
    MediaPlayerState["Buffering"] = "Buffering";
})(MediaPlayerState || (exports.MediaPlayerState = MediaPlayerState = {}));
var ScryptedInterface;
(function (ScryptedInterface) {
    ScryptedInterface["ScryptedDevice"] = "ScryptedDevice";
    ScryptedInterface["ScryptedPlugin"] = "ScryptedPlugin";
    ScryptedInterface["ScryptedPluginRuntime"] = "ScryptedPluginRuntime";
    ScryptedInterface["OnOff"] = "OnOff";
    ScryptedInterface["Brightness"] = "Brightness";
    ScryptedInterface["ColorSettingTemperature"] = "ColorSettingTemperature";
    ScryptedInterface["ColorSettingRgb"] = "ColorSettingRgb";
    ScryptedInterface["ColorSettingHsv"] = "ColorSettingHsv";
    ScryptedInterface["Buttons"] = "Buttons";
    ScryptedInterface["PressButtons"] = "PressButtons";
    ScryptedInterface["Sensors"] = "Sensors";
    ScryptedInterface["Notifier"] = "Notifier";
    ScryptedInterface["StartStop"] = "StartStop";
    ScryptedInterface["Pause"] = "Pause";
    ScryptedInterface["Dock"] = "Dock";
    ScryptedInterface["TemperatureSetting"] = "TemperatureSetting";
    ScryptedInterface["Thermometer"] = "Thermometer";
    ScryptedInterface["HumiditySensor"] = "HumiditySensor";
    ScryptedInterface["Camera"] = "Camera";
    ScryptedInterface["Resolution"] = "Resolution";
    ScryptedInterface["Microphone"] = "Microphone";
    ScryptedInterface["AudioVolumeControl"] = "AudioVolumeControl";
    ScryptedInterface["Display"] = "Display";
    ScryptedInterface["VideoCamera"] = "VideoCamera";
    ScryptedInterface["VideoCameraMask"] = "VideoCameraMask";
    ScryptedInterface["VideoTextOverlays"] = "VideoTextOverlays";
    ScryptedInterface["VideoRecorder"] = "VideoRecorder";
    ScryptedInterface["VideoRecorderManagement"] = "VideoRecorderManagement";
    ScryptedInterface["PanTiltZoom"] = "PanTiltZoom";
    ScryptedInterface["EventRecorder"] = "EventRecorder";
    ScryptedInterface["VideoClips"] = "VideoClips";
    ScryptedInterface["VideoCameraConfiguration"] = "VideoCameraConfiguration";
    ScryptedInterface["Intercom"] = "Intercom";
    ScryptedInterface["Lock"] = "Lock";
    ScryptedInterface["PasswordStore"] = "PasswordStore";
    ScryptedInterface["Scene"] = "Scene";
    ScryptedInterface["Entry"] = "Entry";
    ScryptedInterface["EntrySensor"] = "EntrySensor";
    ScryptedInterface["DeviceProvider"] = "DeviceProvider";
    ScryptedInterface["DeviceDiscovery"] = "DeviceDiscovery";
    ScryptedInterface["DeviceCreator"] = "DeviceCreator";
    ScryptedInterface["Battery"] = "Battery";
    ScryptedInterface["Charger"] = "Charger";
    ScryptedInterface["Reboot"] = "Reboot";
    ScryptedInterface["Refresh"] = "Refresh";
    ScryptedInterface["MediaPlayer"] = "MediaPlayer";
    ScryptedInterface["Online"] = "Online";
    ScryptedInterface["BufferConverter"] = "BufferConverter";
    ScryptedInterface["MediaConverter"] = "MediaConverter";
    ScryptedInterface["Settings"] = "Settings";
    ScryptedInterface["BinarySensor"] = "BinarySensor";
    ScryptedInterface["TamperSensor"] = "TamperSensor";
    ScryptedInterface["Sleep"] = "Sleep";
    ScryptedInterface["PowerSensor"] = "PowerSensor";
    ScryptedInterface["AudioSensor"] = "AudioSensor";
    ScryptedInterface["MotionSensor"] = "MotionSensor";
    ScryptedInterface["AmbientLightSensor"] = "AmbientLightSensor";
    ScryptedInterface["OccupancySensor"] = "OccupancySensor";
    ScryptedInterface["FloodSensor"] = "FloodSensor";
    ScryptedInterface["UltravioletSensor"] = "UltravioletSensor";
    ScryptedInterface["LuminanceSensor"] = "LuminanceSensor";
    ScryptedInterface["PositionSensor"] = "PositionSensor";
    ScryptedInterface["SecuritySystem"] = "SecuritySystem";
    ScryptedInterface["PM10Sensor"] = "PM10Sensor";
    ScryptedInterface["PM25Sensor"] = "PM25Sensor";
    ScryptedInterface["VOCSensor"] = "VOCSensor";
    ScryptedInterface["NOXSensor"] = "NOXSensor";
    ScryptedInterface["CO2Sensor"] = "CO2Sensor";
    ScryptedInterface["AirQualitySensor"] = "AirQualitySensor";
    ScryptedInterface["AirPurifier"] = "AirPurifier";
    ScryptedInterface["FilterMaintenance"] = "FilterMaintenance";
    ScryptedInterface["Readme"] = "Readme";
    ScryptedInterface["OauthClient"] = "OauthClient";
    ScryptedInterface["MixinProvider"] = "MixinProvider";
    ScryptedInterface["HttpRequestHandler"] = "HttpRequestHandler";
    ScryptedInterface["EngineIOHandler"] = "EngineIOHandler";
    ScryptedInterface["PushHandler"] = "PushHandler";
    ScryptedInterface["Program"] = "Program";
    ScryptedInterface["Scriptable"] = "Scriptable";
    ScryptedInterface["ClusterForkInterface"] = "ClusterForkInterface";
    ScryptedInterface["ObjectDetector"] = "ObjectDetector";
    ScryptedInterface["ObjectDetection"] = "ObjectDetection";
    ScryptedInterface["ObjectDetectionPreview"] = "ObjectDetectionPreview";
    ScryptedInterface["ObjectDetectionGenerator"] = "ObjectDetectionGenerator";
    ScryptedInterface["HumiditySetting"] = "HumiditySetting";
    ScryptedInterface["Fan"] = "Fan";
    ScryptedInterface["RTCSignalingChannel"] = "RTCSignalingChannel";
    ScryptedInterface["RTCSignalingClient"] = "RTCSignalingClient";
    ScryptedInterface["LauncherApplication"] = "LauncherApplication";
    ScryptedInterface["ScryptedUser"] = "ScryptedUser";
    ScryptedInterface["VideoFrameGenerator"] = "VideoFrameGenerator";
    ScryptedInterface["StreamService"] = "StreamService";
    ScryptedInterface["TTY"] = "TTY";
    ScryptedInterface["TTYSettings"] = "TTYSettings";
    ScryptedInterface["ChatCompletion"] = "ChatCompletion";
    ScryptedInterface["TextEmbedding"] = "TextEmbedding";
    ScryptedInterface["ImageEmbedding"] = "ImageEmbedding";
    ScryptedInterface["LLMTools"] = "LLMTools";
    ScryptedInterface["ScryptedSystemDevice"] = "ScryptedSystemDevice";
    ScryptedInterface["ScryptedDeviceCreator"] = "ScryptedDeviceCreator";
    ScryptedInterface["ScryptedSettings"] = "ScryptedSettings";
})(ScryptedInterface || (exports.ScryptedInterface = ScryptedInterface = {}));
var ScryptedMimeTypes;
(function (ScryptedMimeTypes) {
    ScryptedMimeTypes["Url"] = "text/x-uri";
    ScryptedMimeTypes["InsecureLocalUrl"] = "text/x-insecure-local-uri";
    ScryptedMimeTypes["LocalUrl"] = "text/x-local-uri";
    ScryptedMimeTypes["ServerId"] = "text/x-server-id";
    ScryptedMimeTypes["PushEndpoint"] = "text/x-push-endpoint";
    ScryptedMimeTypes["SchemePrefix"] = "x-scrypted/x-scrypted-scheme-";
    ScryptedMimeTypes["MediaStreamUrl"] = "text/x-media-url";
    ScryptedMimeTypes["MediaObject"] = "x-scrypted/x-scrypted-media-object";
    ScryptedMimeTypes["RequestMediaObject"] = "x-scrypted/x-scrypted-request-media-object";
    ScryptedMimeTypes["RequestMediaStream"] = "x-scrypted/x-scrypted-request-stream";
    ScryptedMimeTypes["MediaStreamFeedback"] = "x-scrypted/x-media-stream-feedback";
    ScryptedMimeTypes["FFmpegInput"] = "x-scrypted/x-ffmpeg-input";
    ScryptedMimeTypes["FFmpegTranscodeStream"] = "x-scrypted/x-ffmpeg-transcode-stream";
    ScryptedMimeTypes["RTCSignalingChannel"] = "x-scrypted/x-scrypted-rtc-signaling-channel";
    ScryptedMimeTypes["RTCSignalingSession"] = "x-scrypted/x-scrypted-rtc-signaling-session";
    ScryptedMimeTypes["RTCConnectionManagement"] = "x-scrypted/x-scrypted-rtc-connection-management";
    ScryptedMimeTypes["Image"] = "x-scrypted/x-scrypted-image";
})(ScryptedMimeTypes || (exports.ScryptedMimeTypes = ScryptedMimeTypes = {}));
//# sourceMappingURL=index.js.map

/***/ },

/***/ "./src/cameraMixin.ts"
/*!****************************!*\
  !*** ./src/cameraMixin.ts ***!
  \****************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.OnvifRebroadcastCameraMixin = void 0;
const sdk_1 = __importStar(__webpack_require__(/*! @scrypted/sdk */ "./node_modules/@scrypted/sdk/dist/src/index.js"));
const settings_mixin_1 = __webpack_require__(/*! @scrypted/sdk/settings-mixin */ "./node_modules/@scrypted/sdk/dist/src/settings-mixin.js");
const storage_settings_1 = __webpack_require__(/*! @scrypted/sdk/storage-settings */ "./node_modules/@scrypted/sdk/dist/src/storage-settings.js");
const onvifServer_1 = __webpack_require__(/*! ./onvifServer */ "./src/onvifServer.ts");
const ipAlias_1 = __webpack_require__(/*! ./ipAlias */ "./src/ipAlias.ts");
const os_1 = __importDefault(__webpack_require__(/*! os */ "os"));
const { systemManager, mediaManager } = sdk_1.default;
function getLocalIp() {
    const interfaces = os_1.default.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] ?? []) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}
class OnvifRebroadcastCameraMixin extends settings_mixin_1.SettingsMixinDeviceBase {
    constructor(options, plugin) {
        super(options);
        this.onvifServer = null;
        this.discoveredStreams = [];
        this.assignedPort = 0;
        this.killed = false;
        this.motionListener = null;
        this.detectionListener = null;
        this.storageSettings = new storage_settings_1.StorageSettings(this, {
            onvifIp: {
                title: "ONVIF IP address",
                description: "Unique IP address for this camera's ONVIF server (e.g. a virtual IP alias). Required for NVRs like UniFi that identify cameras by IP. Leave empty to use the host's default IP.",
                type: "string",
            },
            onvifPort: {
                title: "ONVIF port",
                description: "Port for this camera ONVIF server (defaults to 8000 when a custom IP is set, or auto-assigned otherwise)",
                type: "number",
            },
            serverEnabled: {
                title: "ONVIF server enabled",
                type: "boolean",
                defaultValue: true,
                immediate: true,
                onPut: async (_oldValue, newValue) => {
                    if (newValue) {
                        await this.discoverStreams();
                        await this.startOnvifServer();
                    }
                    else {
                        await this.stopOnvifServer();
                    }
                },
            },
            debugEvents: {
                title: "Debug events",
                description: "Enable verbose logging for events (motion, object detection)",
                type: "boolean",
                defaultValue: false,
                immediate: true,
            },
        });
        this.plugin = plugin;
        this.logger = {
            log: (message, ...args) => this.console.log(message, ...args),
            debug: (message, ...args) => {
                if (this.storageSettings.values.debugEvents)
                    this.console.log(`[DEBUG] ${message}`, ...args);
            },
            warn: (message, ...args) => this.console.warn(message, ...args),
            error: (message, ...args) => this.console.error(message, ...args),
        };
        setTimeout(() => this.init(), 5000);
    }
    async init() {
        if (this.killed)
            return;
        this.console.log(`ONVIF Rebroadcast mixin initialized for ${this.name}`);
        await this.discoverStreams();
        if (this.killed)
            return;
        if (this.storageSettings.values.serverEnabled) {
            await this.startOnvifServer();
        }
    }
    async getMixinSettings() {
        const settings = await this.storageSettings.getSettings();
        if (this.assignedPort && this.onvifServer?.isRunning) {
            const displayIp = this.storageSettings.values.onvifIp || getLocalIp();
            const baseUrl = `http://${displayIp}:${this.assignedPort}/onvif`;
            settings.push({
                key: 'deviceServiceUrl',
                title: 'ONVIF Device Service Url',
                description: `${baseUrl}/device_service`,
                value: `${baseUrl}/device_service`,
                type: 'string',
                readonly: true,
                subgroup: 'Service URLs',
            });
            settings.push({
                key: 'mediaServiceUrl',
                title: 'ONVIF Media Service Url',
                description: `${baseUrl}/media_service`,
                value: `${baseUrl}/media_service`,
                type: 'string',
                readonly: true,
                subgroup: 'Service URLs',
            });
        }
        return settings;
    }
    async putMixinSetting(key, value) {
        await this.storageSettings.putSetting(key, value);
    }
    /**
     * Discover RTSP rebroadcast streams from Scrypted for this camera.
     */
    async discoverStreams() {
        this.discoveredStreams = [];
        try {
            const device = systemManager.getDeviceById(this.id);
            if (!device?.getSettings)
                return;
            const deviceSettings = await device.getSettings();
            const rtspSettings = deviceSettings.filter((setting) => setting.title === "RTSP Rebroadcast Url");
            // Also try to get video stream options for resolution info
            let streamOptions = [];
            try {
                const videoDevice = systemManager.getDeviceById(this.id);
                if (videoDevice?.getVideoStreamOptions) {
                    streamOptions = await videoDevice.getVideoStreamOptions();
                }
            }
            catch {
                /* ignore */
            }
            for (const setting of rtspSettings) {
                const rtspUrl = setting.value;
                if (!rtspUrl)
                    continue;
                const streamName = setting.subgroup?.replace("Stream: ", "") ?? "Default";
                // Replace localhost with actual IP so external clients can reach it
                const localIp = getLocalIp();
                const resolvedUrl = rtspUrl.replace("localhost", localIp);
                // Try to find resolution from stream options (flexible matching since
                // rebroadcast subgroups use names like "RTMP main.bcs" while stream
                // options use "main.bcs" or similar)
                const matchedOption = streamOptions.find((s) => s.name === streamName ||
                    streamName.includes(s.name) ||
                    s.name?.includes(streamName) ||
                    (s.id && streamName.includes(s.id)));
                const width = matchedOption?.video?.width;
                const height = matchedOption?.video?.height;
                this.discoveredStreams.push({
                    name: streamName,
                    rtspUrl: resolvedUrl,
                    width,
                    height,
                });
            }
            // Log stream option names for debugging resolution matching
            if (streamOptions.length > 0) {
                this.console.log(`${this.name}: stream options: ${streamOptions.map((s) => `${s.name ?? s.id ?? "?"} (${s.video?.width ?? "?"}x${s.video?.height ?? "?"})`).join(", ")}`);
            }
            this.console.log(`${this.name}: found ${this.discoveredStreams.length} RTSP rebroadcast stream(s)`);
            for (const s of this.discoveredStreams) {
                this.console.log(`  - ${s.name}: ${this.sanitizeUrl(s.rtspUrl)} (${s.width ?? "?"}x${s.height ?? "?"})`);
            }
            // If main stream still has no resolution, try probing via snapshot
            if (this.discoveredStreams.length > 0 && !this.discoveredStreams[0].width) {
                try {
                    const cam = systemManager.getDeviceById(this.id);
                    if (cam?.takePicture) {
                        const mediaObject = await cam.takePicture();
                        const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, "image/jpeg");
                        // Parse JPEG SOF0 marker for resolution
                        const res = this.parseJpegResolution(buffer);
                        if (res) {
                            this.console.log(`${this.name}: detected resolution from snapshot: ${res.width}x${res.height}`);
                            // Apply to all streams that lack resolution (main gets full res, others assumed same)
                            for (const s of this.discoveredStreams) {
                                if (!s.width) {
                                    s.width = res.width;
                                    s.height = res.height;
                                }
                            }
                        }
                    }
                }
                catch (e) {
                    this.console.warn(`${this.name}: snapshot resolution probe failed: ${e.message}`);
                }
            }
        }
        catch (e) {
            this.console.warn(`Failed to discover streams for ${this.name}: ${e.message}`);
        }
    }
    /** Strip embedded credentials from URLs before logging */
    sanitizeUrl(url) {
        return url.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@");
    }
    /** Parse JPEG SOF0/SOF2 marker to extract width and height */
    parseJpegResolution(buf) {
        let offset = 0;
        while (offset < buf.length - 1) {
            if (buf[offset] !== 0xff) {
                offset++;
                continue;
            }
            const marker = buf[offset + 1];
            // SOF0 (0xC0) or SOF2 (0xC2) — baseline or progressive
            if (marker === 0xc0 || marker === 0xc2) {
                if (offset + 9 < buf.length) {
                    const height = buf.readUInt16BE(offset + 5);
                    const width = buf.readUInt16BE(offset + 7);
                    if (width > 0 && height > 0)
                        return { width, height };
                }
                return null;
            }
            if (marker === 0xd8 || marker === 0xd9) {
                offset += 2;
                continue;
            } // SOI/EOI
            if (offset + 3 < buf.length) {
                const len = buf.readUInt16BE(offset + 2);
                offset += 2 + len;
            }
            else {
                break;
            }
        }
        return null;
    }
    /**
     * Detect which Scrypted interfaces this device supports and map to ONVIF capabilities.
     */
    detectCapabilities() {
        const device = systemManager.getDeviceById(this.id);
        const interfaces = device?.interfaces ?? this.mixinDeviceInterfaces;
        const has = (iface) => interfaces.includes(iface);
        this.logger.debug(`${this.name} interfaces: ${interfaces.join(", ")}`);
        const capabilities = {
            hasPtz: has(sdk_1.ScryptedInterface.PanTiltZoom),
            hasIntercom: has(sdk_1.ScryptedInterface.Intercom),
            hasMotionSensor: has(sdk_1.ScryptedInterface.MotionSensor),
            hasAudioSensor: has(sdk_1.ScryptedInterface.AudioSensor),
            hasObjectDetection: has(sdk_1.ScryptedInterface.ObjectDetector),
        };
        // Get PTZ sub-capabilities
        if (capabilities.hasPtz) {
            try {
                const device = systemManager.getDeviceById(this.id);
                const ptzCaps = device?.ptzCapabilities;
                if (ptzCaps) {
                    capabilities.ptzCapabilities = {
                        pan: ptzCaps.pan,
                        tilt: ptzCaps.tilt,
                        zoom: ptzCaps.zoom,
                    };
                }
            }
            catch {
                /* ignore */
            }
        }
        this.logger.debug(`${this.name} capabilities: PTZ=${capabilities.hasPtz}, Intercom=${capabilities.hasIntercom}, Motion=${capabilities.hasMotionSensor}, Audio=${capabilities.hasAudioSensor}, ObjectDetect=${capabilities.hasObjectDetection}`);
        return capabilities;
    }
    /**
     * Start the ONVIF server for this camera.
     * This makes the camera discoverable via ONVIF WS-Discovery and
     * serves GetProfiles/GetStreamUri with the Scrypted rebroadcast RTSP URLs.
     */
    async startOnvifServer() {
        await this.stopOnvifServer();
        if (this.discoveredStreams.length === 0) {
            this.logger.debug(`No streams discovered for ${this.name}, trying to discover...`);
            await this.discoverStreams();
        }
        if (this.discoveredStreams.length === 0) {
            this.console.warn(`No RTSP rebroadcast streams found for ${this.name}. Make sure the Rebroadcast plugin is installed.`);
            return;
        }
        const localIp = getLocalIp();
        let onvifIp = this.storageSettings.values.onvifIp || undefined;
        // Auto-assign IP from range if enabled and no manual IP is set
        let proxyPort;
        if (!onvifIp && this.plugin.storageSettings.values.autoIpEnabled) {
            const baseIp = this.plugin.storageSettings.values.ipRangeStart;
            if (baseIp) {
                const iface = this.plugin.storageSettings.values.networkInterface ||
                    "br0";
                const prefix = this.plugin.storageSettings.values.subnetPrefix || 23;
                const gateway = this.plugin.storageSettings.values.gateway || undefined;
                const cameraIndex = this.plugin.getStableIpIndex(this.id);
                const assignedIp = ipAlias_1.IpAliasManager.computeIp(baseIp, cameraIndex, prefix);
                // Extract RTSP targets from discovered streams for proxying
                const rtspTargets = this.discoveredStreams
                    .map((s) => {
                    try {
                        const url = new URL(s.rtspUrl);
                        return { host: url.hostname, port: parseInt(url.port) || 554 };
                    }
                    catch {
                        return null;
                    }
                })
                    .filter((t) => t !== null);
                const result = await this.plugin.ipAliasManager.addAlias(this.id, assignedIp, iface, prefix, gateway, rtspTargets);
                if (result.ok && result.proxyPort) {
                    onvifIp = assignedIp;
                    proxyPort = result.proxyPort;
                    // Rewrite RTSP URLs to go through the proxy container
                    this.discoveredStreams.forEach((stream, idx) => {
                        try {
                            const url = new URL(stream.rtspUrl);
                            url.hostname = assignedIp;
                            url.port = String(554 + idx);
                            stream.rtspUrl = url.toString();
                            this.console.log(`Stream "${stream.name}" → ${stream.rtspUrl}`);
                        }
                        catch { }
                    });
                    this.console.log(`Auto-assigned IP ${assignedIp} to ${this.name} (proxy port ${proxyPort})`);
                }
                else {
                    this.console.warn(`Failed to auto-assign IP ${assignedIp} for ${this.name}. Falling back to shared IP.`);
                }
            }
            else {
                this.console.warn(`Auto-assign IPs is enabled but no IP range start is configured.`);
            }
        }
        // When using proxy containers, the ONVIF server listens on the proxy port
        // on the container's main IP, and the proxy container forwards port 8000 to it.
        // When not using proxies, use port 8000 if we have a unique IP, otherwise auto-assign.
        const port = proxyPort || (onvifIp ? 8000 : (this.storageSettings.values.onvifPort || 0));
        const username = this.plugin.storageSettings.values.username;
        const password = this.plugin.storageSettings.values.password;
        const capabilities = this.detectCapabilities();
        // Use actual device info from Scrypted
        const device = systemManager.getDeviceById(this.id);
        const deviceInfo = device?.info;
        const config = {
            deviceName: device?.name || this.name,
            deviceId: this.id,
            manufacturer: deviceInfo?.manufacturer || "Unknown",
            model: deviceInfo?.model || "Unknown",
            firmwareVersion: deviceInfo?.firmware || deviceInfo?.version || "1.0.0",
            serialNumber: deviceInfo?.serialNumber || `scrypted-${this.id}`,
            hostname: localIp,
            onvifIp,
            proxyMode: !!proxyPort,
            onvifPort: port,
            // UniFi Protect expects at most 2 ONVIF profiles (main + sub stream).
            // Exposing all 4 Scrypted rebroadcast streams causes tiled preview artifacts.
            streams: this.discoveredStreams.slice(0, 2),
            username: username || undefined,
            password: password || undefined,
            capabilities,
            getSnapshot: async () => {
                const cam = systemManager.getDeviceById(this.id);
                if (!cam?.takePicture)
                    throw new Error("Camera does not support snapshots");
                const mediaObject = await cam.takePicture();
                return mediaManager.convertMediaObjectToBuffer(mediaObject, "image/jpeg");
            },
        };
        this.onvifServer = new onvifServer_1.OnvifServer(this.console, config);
        try {
            this.assignedPort = await this.onvifServer.start(port);
            // Save the assigned port to settings so it persists across restarts
            if (this.assignedPort !== port) {
                await this.storageSettings.putSetting("onvifPort", this.assignedPort);
                this.console.log(`Saved assigned port ${this.assignedPort} to settings for ${this.name}`);
            }
            const displayIp = onvifIp || localIp;
            this.console.log(`ONVIF device "${this.name}" available at http://${displayIp}:${proxyPort ? 8000 : this.assignedPort}/onvif/device_service`);
            this.logger.debug(`Camera is now discoverable via ONVIF WS-Discovery`);
            this.startEventListeners(capabilities);
        }
        catch (e) {
            this.console.error(`Failed to start ONVIF server for ${this.name}`, e.message);
        }
    }
    /**
     * Start listening to Scrypted device events and forward them to the ONVIF event queue.
     */
    startEventListeners(capabilities) {
        this.stopEventListeners();
        if (capabilities.hasMotionSensor) {
            this.motionListener = systemManager.listenDevice(this.id, { event: sdk_1.ScryptedInterface.MotionSensor }, (_source, _eventDetails, data) => {
                const motionActive = !!data;
                this.logger.debug(`${this.name} motion: ${motionActive}`);
                this.onvifServer?.pushEvent({
                    topic: "tns1:VideoSource/MotionAlarm",
                    timestamp: new Date(),
                    source: `video_src_0`,
                    data: { State: motionActive },
                });
            });
            this.logger.debug(`Motion event listener started for ${this.name}`);
        }
        if (capabilities.hasObjectDetection) {
            this.detectionListener = systemManager.listenDevice(this.id, { event: sdk_1.ScryptedInterface.ObjectDetector }, (_source, _eventDetails, data) => {
                const detected = data;
                if (!detected?.detections?.length)
                    return;
                for (const detection of detected.detections) {
                    this.logger.debug(`${this.name} detection: ${detection.className} (${((detection.score ?? 0) * 100).toFixed(0)}%)`);
                    this.onvifServer?.pushEvent({
                        topic: "tns1:RuleEngine/ObjectDetector/ObjectDetection",
                        timestamp: new Date(),
                        source: `video_src_0`,
                        data: {
                            ObjectType: detection.className ?? "unknown",
                            IsMotion: detection.className === "motion",
                            Score: detection.score ?? 0,
                        },
                    });
                }
            });
            this.logger.debug(`Object detection event listener started for ${this.name}`);
        }
    }
    stopEventListeners() {
        this.motionListener?.removeListener();
        this.motionListener = null;
        this.detectionListener?.removeListener();
        this.detectionListener = null;
    }
    async stopOnvifServer() {
        this.stopEventListeners();
        if (this.onvifServer) {
            await this.onvifServer.stop();
            this.onvifServer = null;
        }
        // Clean up auto-assigned IP alias
        await this.plugin.ipAliasManager.removeAlias(this.id);
    }
    async release() {
        if (this.killed)
            return;
        this.killed = true;
        this.console.log(`Releasing ONVIF mixin for ${this.name}`);
        await this.stopOnvifServer();
        super.release();
    }
}
exports.OnvifRebroadcastCameraMixin = OnvifRebroadcastCameraMixin;


/***/ },

/***/ "./src/ipAlias.ts"
/*!************************!*\
  !*** ./src/ipAlias.ts ***!
  \************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.IpAliasManager = void 0;
const http_1 = __importDefault(__webpack_require__(/*! http */ "http"));
const os_1 = __importDefault(__webpack_require__(/*! os */ "os"));
const crypto_1 = __importDefault(__webpack_require__(/*! crypto */ "crypto"));
const fs_1 = __importDefault(__webpack_require__(/*! fs */ "fs"));
const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API_TIMEOUT_MS = 30000;
class IpAliasManager {
    constructor(console) {
        this.activeProxies = new Map();
        this.dockerAvailable = null;
        this.networkCreated = false;
        this.nextProxyPort = 18000;
        this.initLock = null;
        this.macvlanNetworkName = null;
        this.console = console;
    }
    static generateMac(deviceId) {
        const hash = crypto_1.default.createHash("md5").update(`onvif-mac-${deviceId}`).digest();
        const bytes = [0x02, hash[0], hash[1], hash[2], hash[3], hash[4]];
        return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
    }
    static computeIp(baseIp, index, prefixLength) {
        const parts = baseIp.split(".").map(Number);
        let carry = index;
        for (let i = 3; i >= 0; i--) {
            parts[i] += carry;
            carry = Math.floor(parts[i] / 256);
            parts[i] = parts[i] % 256;
        }
        // Validate the computed IP is within the same subnet as the base IP
        if (prefixLength !== undefined) {
            const baseParts = baseIp.split(".").map(Number);
            const baseNum = ((baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3]) >>> 0;
            const resultNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
            const mask = (~0 << (32 - prefixLength)) >>> 0;
            if ((baseNum & mask) !== (resultNum & mask)) {
                throw new Error(`Computed IP ${parts.join(".")} (index ${index}) is outside the /${prefixLength} subnet of ${baseIp}`);
            }
        }
        return parts.join(".");
    }
    /**
     * Sanitize a string for use as a Docker container name.
     * Docker allows [a-zA-Z0-9_.-] only.
     */
    static sanitizeContainerName(name) {
        return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    }
    hasDockerSocket() {
        if (this.dockerAvailable !== null)
            return this.dockerAvailable;
        this.dockerAvailable = fs_1.default.existsSync(DOCKER_SOCKET);
        if (this.dockerAvailable) {
            this.console.log("Docker socket found — proxy container mode available");
        }
        return this.dockerAvailable;
    }
    /**
     * Get the container's main IP (for proxying traffic to).
     */
    getContainerIp() {
        const interfaces = os_1.default.networkInterfaces();
        for (const [, addrs] of Object.entries(interfaces)) {
            for (const addr of addrs ?? []) {
                if (addr.family === "IPv4" && !addr.internal)
                    return addr.address;
            }
        }
        return "127.0.0.1";
    }
    /**
     * Find a Docker bridge network that Scrypted itself is connected to, and
     * return our IP on it. macvlan proxy containers will also join this bridge
     * so they can forward traffic to Scrypted without hitting the macvlan-to-host
     * isolation wall (Linux macvlan containers cannot reach the host's physical IP).
     */
    async findBridgeConnection() {
        try {
            // Collect all our own IPs so we can identify which container is "us"
            const myIps = new Set();
            for (const addrs of Object.values(os_1.default.networkInterfaces())) {
                for (const addr of addrs ?? []) {
                    if (addr.family === "IPv4")
                        myIps.add(addr.address);
                }
            }
            const networks = await this.dockerApiGet("/networks");
            for (const net of networks ?? []) {
                if (net.Driver !== "bridge")
                    continue;
                const detail = await this.dockerApiGet(`/networks/${net.Id}`);
                for (const container of Object.values(detail?.Containers ?? {})) {
                    const ip = container.IPv4Address?.split("/")[0];
                    if (ip && myIps.has(ip)) {
                        return { network: net.Name, ip };
                    }
                }
            }
        }
        catch (e) {
            this.console.debug?.(`Bridge network detection failed: ${e.message}`);
        }
        return null;
    }
    /**
     * Allocate a unique port for the ONVIF server to listen on internally.
     * This port is proxied through the macvlan proxy container.
     */
    allocateProxyPort() {
        return this.nextProxyPort++;
    }
    /**
     * Serialize access to shared Docker initialization (network + image).
     * Prevents race conditions when multiple cameras initialize simultaneously.
     */
    async withInitLock(fn) {
        while (this.initLock) {
            await this.initLock;
        }
        let resolve;
        this.initLock = new Promise((r) => (resolve = r));
        try {
            return await fn();
        }
        finally {
            this.initLock = null;
            resolve();
        }
    }
    /**
     * Create a dedicated macvlan Docker network on br0 for ONVIF proxy containers.
     * This is separate from the Scrypted container's ipvlan network (br0.2),
     * giving each proxy container a unique MAC address.
     */
    async ensureMacvlanNetwork(parentIface, subnet, gateway) {
        if (this.macvlanNetworkName)
            return true;
        const networks = (await this.dockerApiGet("/networks")) || [];
        const netSummary = networks.map((n) => `${n.Name}(${n.Driver})`).join(", ");
        this.console.log(`Available Docker networks: ${netSummary}`);
        // Check if our dedicated network already exists
        const existing = networks.find((n) => n.Name === IpAliasManager.NETWORK_NAME);
        if (existing) {
            this.macvlanNetworkName = IpAliasManager.NETWORK_NAME;
            this.console.log(`Using existing ${IpAliasManager.NETWORK_NAME} network (${existing.Driver})`);
            return true;
        }
        // Create a new macvlan network on the specified parent interface
        this.console.log(`Creating macvlan network '${IpAliasManager.NETWORK_NAME}' on ${parentIface} (${subnet})...`);
        const result = await this.dockerApiPost("/networks/create", {
            Name: IpAliasManager.NETWORK_NAME,
            Driver: "macvlan",
            Options: { parent: parentIface },
            IPAM: {
                Config: [{ Subnet: subnet, Gateway: gateway }],
            },
        });
        if (result?.Id || result?.id) {
            this.macvlanNetworkName = IpAliasManager.NETWORK_NAME;
            this.console.log(`Created macvlan network on ${parentIface} (${subnet})`);
            return true;
        }
        // Handle race condition: another camera already created it
        if (result?.message?.includes("already exists")) {
            this.macvlanNetworkName = IpAliasManager.NETWORK_NAME;
            this.console.log(`Network ${IpAliasManager.NETWORK_NAME} already created by another camera`);
            return true;
        }
        this.console.error(`Failed to create macvlan network: ${JSON.stringify(result)}`);
        return false;
    }
    /**
     * Create a proxy container with its own macvlan IP and MAC.
     * The container runs socat to forward port 8000 to the Scrypted container's
     * ONVIF server port.
     */
    async addAlias(deviceId, ip, parentIface, prefix, gatewayOverride, rtspTargets) {
        if (!this.hasDockerSocket()) {
            this.console.error(`Docker socket not found at ${DOCKER_SOCKET}`);
            return { ok: false };
        }
        const mac = IpAliasManager.generateMac(deviceId);
        const containerName = IpAliasManager.sanitizeContainerName(`onvif-proxy-${deviceId}`);
        // Already managed
        const existing = this.activeProxies.get(deviceId);
        if (existing?.ip === ip) {
            // Check if proxy container is still running
            try {
                const info = await this.dockerApiGet(`/containers/${containerName}/json`);
                if (info?.State?.Running) {
                    return { ok: true, proxyPort: existing.proxyPort };
                }
            }
            catch (e) {
                this.console.debug?.(`Could not inspect existing container ${containerName}: ${e.message}`);
            }
        }
        // Serialize network/image initialization to prevent race conditions
        const initOk = await this.withInitLock(async () => {
            // Compute network details from the assigned IP
            const ipParts = ip.split(".").map(Number);
            const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
            const mask = (~0 << (32 - prefix)) >>> 0;
            const netNum = (ipNum & mask) >>> 0;
            const subnet = `${(netNum >>> 24) & 0xff}.${(netNum >>> 16) & 0xff}.${(netNum >>> 8) & 0xff}.${netNum & 0xff}/${prefix}`;
            const gateway = gatewayOverride || `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.1`;
            // Ensure macvlan network exists on the specified parent interface
            const netOk = await this.ensureMacvlanNetwork(parentIface, subnet, gateway);
            if (!netOk)
                return false;
            // Ensure socat image is available
            await this.ensureSocatImage();
            return true;
        });
        if (!initOk)
            return { ok: false };
        // Allocate a unique internal port for the ONVIF server
        const proxyPort = this.allocateProxyPort();
        // Prefer a Docker bridge IP over the physical host IP.
        // macvlan containers cannot reach the Docker host via its physical IP due to
        // Linux macvlan isolation — socat would connect to the host and get EHOSTUNREACH.
        // Connecting the proxy to the same bridge network as Scrypted bypasses this.
        const bridge = await this.findBridgeConnection();
        const scryptedIp = bridge?.ip ?? this.getContainerIp();
        if (!bridge) {
            this.console.warn("Scrypted does not appear to be on a Docker bridge network. " +
                "Falling back to host IP for socat forwarding — if ONVIF adoption fails, " +
                "a macvlan shim interface on the host may be required.");
        }
        // Remove existing proxy container if any
        await this.removeProxyContainer(containerName);
        // Build socat command: always proxy ONVIF (8000), optionally proxy RTSP (554+)
        let cmd;
        let entrypoint;
        if (rtspTargets && rtspTargets.length > 0) {
            // Run multiple socat instances: ONVIF + one per RTSP stream
            // Validate hostnames/ports to prevent shell injection
            const sanitizeHost = (h) => {
                if (!/^[a-zA-Z0-9._-]+$/.test(h))
                    throw new Error(`Invalid hostname: ${h}`);
                return h;
            };
            const sanitizePort = (p) => {
                if (!Number.isInteger(p) || p < 1 || p > 65535)
                    throw new Error(`Invalid port: ${p}`);
                return p;
            };
            const socatCmds = [`socat TCP-LISTEN:8000,fork,reuseaddr TCP:${sanitizeHost(scryptedIp)}:${sanitizePort(proxyPort)}`];
            rtspTargets.forEach((target, idx) => {
                const listenPort = 554 + idx;
                socatCmds.push(`socat TCP-LISTEN:${sanitizePort(listenPort)},fork,reuseaddr TCP:${sanitizeHost(target.host)}:${sanitizePort(target.port)}`);
            });
            // Override entrypoint to use sh directly (alpine/socat prepends "socat" to Cmd)
            entrypoint = ["/bin/sh"];
            cmd = ["-c", socatCmds.map((c) => `${c} &`).join(" ") + " wait"];
        }
        else {
            cmd = [`TCP-LISTEN:8000,fork,reuseaddr`, `TCP:${scryptedIp}:${proxyPort}`];
            entrypoint = undefined;
        }
        // Create proxy container on our dedicated macvlan network with unique MAC
        const containerConfig = {
            Image: "alpine/socat:latest",
            Entrypoint: entrypoint,
            Cmd: cmd,
            MacAddress: mac,
            HostConfig: {
                RestartPolicy: { Name: "unless-stopped" },
                NetworkMode: this.macvlanNetworkName,
            },
            NetworkingConfig: {
                EndpointsConfig: {
                    [this.macvlanNetworkName]: {
                        IPAMConfig: { IPv4Address: ip },
                    },
                },
            },
        };
        const createResult = await this.dockerApiPost(`/containers/create?name=${containerName}`, containerConfig);
        if (!createResult?.Id) {
            this.console.error(`Failed to create proxy container for ${ip}: ${JSON.stringify(createResult)}`);
            return { ok: false };
        }
        // Start the container
        const startResult = await this.dockerApiPost(`/containers/${createResult.Id}/start`, {});
        if (startResult?.message) {
            this.console.error(`Failed to start proxy container for ${ip}: ${startResult.message}`);
            await this.removeProxyContainer(containerName);
            return { ok: false };
        }
        // Connect the proxy container to Scrypted's bridge network so socat can reach
        // Scrypted via the bridge IP (macvlan containers cannot reach the host physical IP).
        if (bridge) {
            try {
                await this.dockerApiPost(`/networks/${bridge.network}/connect`, { Container: createResult.Id });
                this.console.log(`Proxy container connected to bridge network '${bridge.network}' → socat target ${bridge.ip}:${proxyPort}`);
            }
            catch (e) {
                this.console.warn(`Could not connect proxy to bridge network '${bridge.network}': ${e.message}`);
            }
        }
        // Wait a moment then verify it's running
        await new Promise((r) => setTimeout(r, 2000));
        try {
            const info = await this.dockerApiGet(`/containers/${containerName}/json`);
            if (info?.State?.Running) {
                const actualIp = info?.NetworkSettings?.Networks?.[this.macvlanNetworkName]?.IPAddress || ip;
                const actualMac = info?.NetworkSettings?.Networks?.[this.macvlanNetworkName]?.MacAddress || mac;
                this.activeProxies.set(deviceId, { ip: actualIp, mac: actualMac, containerId: createResult.Id, proxyPort });
                this.console.log(`Proxy container ${containerName}: IP=${actualIp} MAC=${actualMac} → ${scryptedIp}:${proxyPort}`);
                return { ok: true, proxyPort };
            }
            const exitCode = info?.State?.ExitCode;
            this.console.error(`Proxy container exited with code ${exitCode}. State: ${JSON.stringify(info?.State)}`);
        }
        catch (e) {
            this.console.error(`Failed to inspect proxy container: ${e.message}`);
        }
        await this.removeProxyContainer(containerName);
        return { ok: false };
    }
    /**
     * Ensure the socat image is available locally.
     */
    async ensureSocatImage() {
        // Check if image exists
        try {
            const images = await this.dockerApiGet("/images/json");
            const hasImage = images?.some?.((img) => img.RepoTags?.some?.((t) => t.includes("socat")));
            if (hasImage)
                return;
        }
        catch (e) {
            this.console.debug?.(`Could not check Docker images: ${e.message}`);
        }
        // Pull the image (streaming response — need to consume the full stream)
        this.console.log("Pulling alpine/socat image (requires internet access)...");
        await new Promise((resolve, reject) => {
            const req = http_1.default.request({
                socketPath: DOCKER_SOCKET,
                path: "/images/create?fromImage=alpine%2Fsocat&tag=latest",
                method: "POST",
            }, (res) => {
                res.on("data", () => { }); // consume stream
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        this.console.error(`Failed to pull alpine/socat (HTTP ${res.statusCode}). ` +
                            `In air-gapped environments, pre-pull the image: docker pull alpine/socat`);
                    }
                    else {
                        this.console.log("Image pull complete");
                    }
                    resolve();
                });
            });
            req.on("error", (e) => {
                this.console.error(`Failed to pull alpine/socat: ${e.message}. ` +
                    `In air-gapped environments, pre-pull the image: docker pull alpine/socat`);
                reject(e);
            });
            req.setTimeout(120000, () => reject(new Error("Image pull timeout")));
            req.end();
        });
    }
    /**
     * Remove a proxy container. Waits for stop to complete before deleting.
     */
    async removeProxyContainer(name) {
        // Stop the container first and wait for it to complete
        try {
            await this.dockerApiPost(`/containers/${name}/stop?t=5`, {});
        }
        catch {
            // Container may not exist or already stopped
        }
        // Now delete it
        await new Promise((resolve) => {
            const req = http_1.default.request({ socketPath: DOCKER_SOCKET, path: `/containers/${name}?force=true`, method: "DELETE" }, (res) => { res.resume(); res.on("end", () => resolve()); });
            req.on("error", () => resolve());
            req.setTimeout(DOCKER_API_TIMEOUT_MS, () => resolve());
            req.end();
        });
    }
    /**
     * Remove a proxy for a camera.
     */
    async removeAlias(deviceId) {
        const proxy = this.activeProxies.get(deviceId);
        if (!proxy)
            return;
        const containerName = IpAliasManager.sanitizeContainerName(`onvif-proxy-${deviceId}`);
        await this.removeProxyContainer(containerName);
        this.activeProxies.delete(deviceId);
        this.console.log(`Removed proxy container for ${proxy.ip}`);
    }
    /**
     * Remove all managed proxies. Call on plugin shutdown to prevent orphaned containers.
     */
    async removeAll() {
        for (const id of [...this.activeProxies.keys()]) {
            await this.removeAlias(id);
        }
    }
    // ─── Docker API helpers ─────────────────────────────────────────
    dockerApiGet(path) {
        return new Promise((resolve, reject) => {
            const req = http_1.default.request({ socketPath: DOCKER_SOCKET, path, method: "GET" }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        reject(new Error(data.substring(0, 200)));
                    }
                });
            });
            req.on("error", reject);
            req.setTimeout(DOCKER_API_TIMEOUT_MS, () => {
                req.destroy();
                reject(new Error(`Docker API GET ${path} timed out after ${DOCKER_API_TIMEOUT_MS}ms`));
            });
            req.end();
        });
    }
    dockerApiPost(path, body) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            const req = http_1.default.request({
                socketPath: DOCKER_SOCKET,
                path,
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) },
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        resolve({ statusCode: res.statusCode, raw: data.substring(0, 500) });
                    }
                });
            });
            req.on("error", reject);
            req.setTimeout(DOCKER_API_TIMEOUT_MS, () => {
                req.destroy();
                reject(new Error(`Docker API POST ${path} timed out after ${DOCKER_API_TIMEOUT_MS}ms`));
            });
            req.write(bodyStr);
            req.end();
        });
    }
}
exports.IpAliasManager = IpAliasManager;
IpAliasManager.NETWORK_NAME = "onvif_cameras";


/***/ },

/***/ "./src/onvifServer.ts"
/*!****************************!*\
  !*** ./src/onvifServer.ts ***!
  \****************************/
(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.OnvifServer = void 0;
const http_1 = __importDefault(__webpack_require__(/*! http */ "http"));
const dgram_1 = __importDefault(__webpack_require__(/*! dgram */ "dgram"));
const crypto_1 = __importDefault(__webpack_require__(/*! crypto */ "crypto"));
const uuid_1 = __webpack_require__(/*! uuid */ "./node_modules/uuid/dist/esm-node/index.js");
const ONVIF_DEVICE_NS = "http://www.onvif.org/ver10/device/wsdl";
const ONVIF_MEDIA_NS = "http://www.onvif.org/ver10/media/wsdl";
const ONVIF_PTZ_NS = "http://www.onvif.org/ver20/ptz/wsdl";
const ONVIF_EVENT_NS = "http://www.onvif.org/ver10/events/wsdl";
const ONVIF_IMAGING_NS = "http://www.onvif.org/ver20/imaging/wsdl";
const ONVIF_SCHEMA_NS = "http://www.onvif.org/ver10/schema";
const WS_DISCOVERY_PORT = 3702;
const WS_DISCOVERY_ADDR = "239.255.255.250";
function soapEnvelope(body) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
    xmlns:tds="${ONVIF_DEVICE_NS}"
    xmlns:trt="${ONVIF_MEDIA_NS}"
    xmlns:tptz="${ONVIF_PTZ_NS}"
    xmlns:tev="${ONVIF_EVENT_NS}"
    xmlns:timg="${ONVIF_IMAGING_NS}"
    xmlns:tt="${ONVIF_SCHEMA_NS}">
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}
const MAX_EVENTS_PER_SUBSCRIPTION = 200;
const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB
const MAX_DIGEST_NONCES = 1000;
const NONCE_EXPIRY_MS = 300_000; // 5 minutes
const MAX_SUBSCRIPTIONS = 50;
const SUBSCRIPTION_CLEANUP_INTERVAL_MS = 60_000;
const SNAPSHOT_MIN_INTERVAL_MS = 1000; // 1 snapshot/sec per server
class OnvifServer {
    constructor(console, config) {
        this.server = null;
        this.discoverySocket = null;
        this.responseSocket = null;
        this.assignedPort = 0;
        this.subscriptions = new Map();
        this.digestNonces = new Map(); // nonce → expiry timestamp
        this.subscriptionCleanupTimer = null;
        this.lastSnapshotTime = 0;
        this.console = console;
        this.config = config;
        // Deterministic UUID based on device ID so the same camera always has the same endpoint
        const hash = crypto_1.default
            .createHash("sha256")
            .update(`scrypted-onvif-${config.deviceId}`)
            .digest("hex");
        this.deviceUuid = `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }
    updateStreams(streams) {
        this.config.streams = streams;
    }
    pushEvent(event) {
        for (const sub of this.subscriptions.values()) {
            sub.events.push(event);
            // Trim old events
            if (sub.events.length > MAX_EVENTS_PER_SUBSCRIPTION) {
                sub.events.splice(0, sub.events.length - MAX_EVENTS_PER_SUBSCRIPTION);
            }
        }
    }
    async start(port) {
        if (this.server) {
            await this.stop();
        }
        // If port is 0, derive a deterministic port from the device ID (range 10000-60000)
        // so the same camera always gets the same port across restarts.
        if (port === 0) {
            const hash = crypto_1.default
                .createHash("md5")
                .update(this.config.deviceId)
                .digest();
            port = 10000 + (hash.readUInt16BE(0) % 50000);
        }
        // Try the requested port, retrying a few times with a delay
        // to allow the previous server to fully release the port
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.tryListen(port);
            }
            catch (err) {
                if (err?.code === "EADDRINUSE" && attempt < 2) {
                    this.console.warn(`Port ${port} in use for ${this.config.deviceName}, retrying in 1s... (attempt ${attempt + 1}/3)`);
                    await new Promise((r) => setTimeout(r, 1000));
                    continue;
                }
                if (err?.code === "EADDRINUSE") {
                    this.console.warn(`Port ${port} still in use for ${this.config.deviceName}, using random port`);
                    return await this.tryListen(0);
                }
                throw err;
            }
        }
        return await this.tryListen(0);
    }
    /**
     * The effective IP address to use in all service URLs and discovery responses.
     * When onvifIp is set, this camera appears as a unique device on that IP.
     */
    get serviceIp() {
        return this.config.onvifIp || this.config.hostname;
    }
    /** The port that external clients see (8000 in proxy mode, actual port otherwise) */
    get servicePort() {
        return this.config.proxyMode ? 8000 : this.assignedPort;
    }
    tryListen(port) {
        return new Promise((resolve, reject) => {
            const server = http_1.default.createServer((req, res) => {
                this.handleRequest(req, res);
            });
            server.on("error", (err) => {
                server.close();
                reject(err);
            });
            // Bind to the specific onvifIp if set, otherwise all interfaces
            // In proxy mode, bind to all interfaces (proxy container forwards to us).
            // Otherwise bind to the specific IP if set.
            const bindHost = this.config.proxyMode ? undefined : (this.config.onvifIp || undefined);
            server.listen(port, bindHost, () => {
                this.server = server;
                const addr = server.address();
                this.assignedPort = addr?.port ?? port;
                this.console.log(`ONVIF server for ${this.config.deviceName} listening on port ${this.assignedPort}`);
                this.startDiscovery();
                this.startSubscriptionCleanup();
                resolve(this.assignedPort);
            });
        });
    }
    async stop() {
        this.stopDiscovery();
        this.stopSubscriptionCleanup();
        this.subscriptions.clear();
        this.digestNonces.clear();
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.console.log(`ONVIF server stopped for ${this.config.deviceName}`);
                    this.server = null;
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
    get isRunning() {
        return this.server !== null;
    }
    handleRequest(req, res) {
        const url = req.url ?? "/";
        // Handle snapshot requests (non-SOAP, plain HTTP GET)
        if (req.method === "GET" && url.startsWith("/snapshot")) {
            // Authenticate snapshot requests via HTTP Digest/Basic
            if (this.config.username && !this.validateHttpAuth(req)) {
                this.sendDigestChallenge(res);
                return;
            }
            this.handleSnapshotRequest(req, res);
            return;
        }
        let body = "";
        let aborted = false;
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > MAX_REQUEST_SIZE) {
                aborted = true;
                res.writeHead(413, { "Content-Type": "text/plain" });
                res.end("Request too large");
                req.destroy();
            }
        });
        req.on("end", () => {
            if (aborted)
                return;
            try {
                const response = this.routeSoapRequest(body, url, req);
                if (response === "__HTTP_DIGEST_CHALLENGE__") {
                    this.sendDigestChallenge(res);
                    return;
                }
                res.writeHead(200, {
                    "Content-Type": "application/soap+xml; charset=utf-8",
                });
                res.end(response);
            }
            catch (e) {
                this.console.error("ONVIF request error");
                res.writeHead(500, {
                    "Content-Type": "application/soap+xml; charset=utf-8",
                });
                res.end(this.soapFault("Server", "Internal server error"));
            }
        });
    }
    sendDigestChallenge(res) {
        // Clean expired nonces
        const now = Date.now();
        for (const [nonce, expiry] of this.digestNonces) {
            if (expiry < now)
                this.digestNonces.delete(nonce);
        }
        // Evict oldest nonces if table is full
        while (this.digestNonces.size >= MAX_DIGEST_NONCES) {
            const oldest = this.digestNonces.keys().next().value;
            if (oldest)
                this.digestNonces.delete(oldest);
            else
                break;
        }
        const nonce = crypto_1.default.randomBytes(16).toString("hex");
        this.digestNonces.set(nonce, now + NONCE_EXPIRY_MS);
        res.writeHead(401, {
            "WWW-Authenticate": `Digest realm="ONVIF", nonce="${nonce}", qop="auth"`,
            "Content-Type": "text/plain",
        });
        res.end("Unauthorized");
    }
    /** Timing-safe string comparison to prevent credential brute-force via timing side-channel */
    safeEqual(a, b) {
        if (a.length !== b.length)
            return false;
        return crypto_1.default.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }
    validateHttpAuth(req) {
        const authHeader = req.headers["authorization"];
        if (!authHeader)
            return false;
        const { username, password } = this.config;
        if (!username)
            return true;
        if (authHeader.startsWith("Basic ")) {
            const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
            const colonIdx = decoded.indexOf(":");
            if (colonIdx < 0)
                return false;
            const httpUser = decoded.slice(0, colonIdx);
            const httpPass = decoded.slice(colonIdx + 1);
            return this.safeEqual(httpUser, username) && this.safeEqual(httpPass, password ?? "");
        }
        if (authHeader.startsWith("Digest ")) {
            return this.validateDigestAuth(authHeader, req.method ?? "GET");
        }
        return false;
    }
    validateDigestAuth(authHeader, method) {
        const { username, password } = this.config;
        if (!username || !password)
            return false;
        // Parse Digest parameters
        const params = {};
        const regex = /(\w+)=(?:"([^"]+)"|(\w+))/g;
        let match;
        while ((match = regex.exec(authHeader)) !== null) {
            params[match[1]] = match[2] ?? match[3];
        }
        if (!this.safeEqual(params.username ?? "", username))
            return false;
        // Verify nonce is valid
        const nonce = params.nonce;
        if (!nonce || !this.digestNonces.has(nonce))
            return false;
        if (this.digestNonces.get(nonce) < Date.now()) {
            this.digestNonces.delete(nonce);
            return false;
        }
        const realm = params.realm ?? "ONVIF";
        const uri = params.uri ?? "/";
        const nc = params.nc ?? "";
        const cnonce = params.cnonce ?? "";
        const qop = params.qop;
        // MD5 is required by HTTP Digest spec (RFC 2617) — NVR clients only support MD5
        const ha1 = crypto_1.default.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
        const ha2 = crypto_1.default.createHash("md5").update(`${method}:${uri}`).digest("hex");
        let expected;
        if (qop === "auth") {
            expected = crypto_1.default.createHash("md5").update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest("hex");
        }
        else {
            expected = crypto_1.default.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
        }
        const valid = this.safeEqual(params.response ?? "", expected);
        // Invalidate nonce after use to prevent replay attacks
        if (valid)
            this.digestNonces.delete(nonce);
        return valid;
    }
    async handleSnapshotRequest(req, res) {
        if (!this.config.getSnapshot) {
            res.writeHead(503, { "Content-Type": "text/plain" });
            res.end("Snapshot not available");
            return;
        }
        // Rate limit snapshots
        const now = Date.now();
        if (now - this.lastSnapshotTime < SNAPSHOT_MIN_INTERVAL_MS) {
            res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "1" });
            res.end("Too many requests");
            return;
        }
        this.lastSnapshotTime = now;
        try {
            const jpegBuffer = await this.config.getSnapshot();
            res.writeHead(200, {
                "Content-Type": "image/jpeg",
                "Content-Length": jpegBuffer.length,
                "Cache-Control": "no-cache",
            });
            res.end(jpegBuffer);
        }
        catch (e) {
            this.console.error("Snapshot error", e.message);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Snapshot failed");
        }
    }
    routeSoapRequest(body, url, req) {
        // These endpoints are always unauthenticated (needed for initial discovery/capability negotiation)
        if (body.includes("GetSystemDateAndTime"))
            return this.getSystemDateAndTime();
        if (body.includes("GetCapabilities"))
            return this.getCapabilities();
        if (body.includes("GetServices"))
            return this.getServices();
        if (body.includes("GetDeviceInformation"))
            return this.getDeviceInformation();
        if (body.includes("GetScopes"))
            return this.getScopes();
        if (body.includes("GetNetworkInterfaces"))
            return this.getNetworkInterfaces();
        // Validate credentials (WS-Security in SOAP body or HTTP Basic/Digest in headers)
        const authError = this.validateAuth(body, req);
        if (authError)
            return authError;
        // ─── Media Service ───────────────────────────────────────────
        if (body.includes("GetProfiles"))
            return this.getProfiles();
        if (body.includes("GetStreamUri"))
            return this.getStreamUri(body);
        if (body.includes("GetSnapshotUri"))
            return this.getSnapshotUri(body);
        if (body.includes("GetVideoSources"))
            return this.getVideoSources();
        if (body.includes("GetVideoSourceConfigurations"))
            return this.getVideoSourceConfigurations();
        if (body.includes("GetAudioSources"))
            return this.getAudioSources();
        if (body.includes("GetAudioSourceConfigurations"))
            return this.getAudioSourceConfigurations();
        if (body.includes("GetAudioOutputs"))
            return this.getAudioOutputs();
        if (body.includes("GetAudioOutputConfigurations"))
            return this.getAudioOutputConfigurations();
        if (body.includes("GetAudioEncoderConfigurations"))
            return this.getAudioEncoderConfigurations();
        if (body.includes("GetAudioDecoderConfigurations"))
            return this.getAudioDecoderConfigurations();
        if (body.includes("GetVideoEncoderConfigurations"))
            return this.getVideoEncoderConfigurations();
        // ─── PTZ Service ─────────────────────────────────────────────
        if (body.includes("GetConfigurations") && url.includes("ptz"))
            return this.getPtzConfigurations();
        if (body.includes("GetConfiguration") && url.includes("ptz"))
            return this.getPtzConfiguration(body);
        if (body.includes("GetNodes"))
            return this.getPtzNodes();
        if (body.includes("GetNode") && !body.includes("GetNodes"))
            return this.getPtzNode(body);
        if (body.includes("ContinuousMove"))
            return this.ptzContinuousMove(body);
        if (body.includes("AbsoluteMove"))
            return this.ptzAbsoluteMove(body);
        if (body.includes("RelativeMove"))
            return this.ptzRelativeMove(body);
        if (body.includes("Stop") && url.includes("ptz"))
            return this.ptzStop(body);
        if (body.includes("GotoHomePosition"))
            return this.ptzGotoHome(body);
        if (body.includes("GotoPreset"))
            return this.ptzGotoPreset(body);
        if (body.includes("GetPresets"))
            return this.ptzGetPresets(body);
        if (body.includes("GetStatus") && url.includes("ptz"))
            return this.ptzGetStatus(body);
        // ─── Event Service ───────────────────────────────────────────
        if (body.includes("GetEventProperties"))
            return this.getEventProperties();
        if (body.includes("GetServiceCapabilities") && url.includes("event"))
            return this.getEventServiceCapabilities();
        if (body.includes("CreatePullPointSubscription"))
            return this.createPullPointSubscription();
        if (body.includes("PullMessages"))
            return this.pullMessages(body);
        if (body.includes("Unsubscribe"))
            return this.unsubscribe(body);
        if (body.includes("Renew"))
            return this.renewSubscription(body);
        this.console.warn(`Unhandled ONVIF request: ${body.substring(0, 300)}...`);
        return this.soapFault("Sender", "Action not supported");
    }
    /**
     * Validate authentication from WS-Security (SOAP body) or HTTP Basic auth headers.
     * Returns a SOAP fault string if auth fails, or null if OK.
     */
    validateAuth(body, req) {
        const { username, password } = this.config;
        if (!username)
            return null;
        // 1. Try WS-Security UsernameToken in SOAP body
        const wsUsername = this.extractValue(body, "Username");
        if (wsUsername) {
            if (!this.safeEqual(wsUsername, username)) {
                return this.soapFault("Sender", "Not authorized");
            }
            const wsPassword = this.extractValue(body, "Password");
            const wsNonce = this.extractValue(body, "Nonce");
            const wsCreated = this.extractValue(body, "Created");
            // WS-Security Password Digest: Base64(SHA1(Nonce + Created + Password))
            if (wsNonce && wsCreated && password) {
                const nonceBuffer = Buffer.from(wsNonce, "base64");
                const hash = crypto_1.default.createHash("sha1");
                hash.update(nonceBuffer);
                hash.update(wsCreated);
                hash.update(password);
                const expectedDigest = hash.digest("base64");
                if (this.safeEqual(wsPassword, expectedDigest)) {
                    return null;
                }
            }
            // Plaintext password comparison (some ONVIF clients send PasswordText type)
            if (password && wsPassword && this.safeEqual(wsPassword, password)) {
                return null;
            }
            return this.soapFault("Sender", "Not authorized");
        }
        // 2. Try HTTP auth headers (Basic or Digest)
        if (req && this.validateHttpAuth(req)) {
            return null;
        }
        const authHeader = req?.headers?.["authorization"];
        if (authHeader) {
            // Auth header present but validation failed
            return this.soapFault("Sender", "Not authorized");
        }
        // 3. No credentials provided — send HTTP 401 Digest challenge
        // This signals handleRequest to send a proper 401 response
        return "__HTTP_DIGEST_CHALLENGE__";
    }
    // ─── Device Service ──────────────────────────────────────────────
    getDeviceInformation() {
        return soapEnvelope(`
    <tds:GetDeviceInformationResponse>
      <tds:Manufacturer>${this.escXml(this.config.manufacturer)}</tds:Manufacturer>
      <tds:Model>${this.escXml(this.config.model)}</tds:Model>
      <tds:FirmwareVersion>${this.escXml(this.config.firmwareVersion)}</tds:FirmwareVersion>
      <tds:SerialNumber>${this.escXml(this.config.serialNumber)}</tds:SerialNumber>
      <tds:HardwareId>${this.escXml(this.config.serialNumber)}</tds:HardwareId>
    </tds:GetDeviceInformationResponse>`);
    }
    getCapabilities() {
        const serviceUrl = `http://${this.serviceIp}:${this.servicePort}/onvif`;
        const caps = this.config.capabilities;
        let ptzCapXml = "";
        if (caps.hasPtz) {
            ptzCapXml = `
        <tt:PTZ>
          <tt:XAddr>${serviceUrl}/ptz_service</tt:XAddr>
        </tt:PTZ>`;
        }
        let eventsCapXml = "";
        if (caps.hasMotionSensor ||
            caps.hasAudioSensor ||
            caps.hasObjectDetection) {
            eventsCapXml = `
        <tt:Events>
          <tt:XAddr>${serviceUrl}/event_service</tt:XAddr>
          <tt:WSSubscriptionPolicySupport>false</tt:WSSubscriptionPolicySupport>
          <tt:WSPullPointSupport>true</tt:WSPullPointSupport>
        </tt:Events>`;
        }
        return soapEnvelope(`
    <tds:GetCapabilitiesResponse>
      <tds:Capabilities>
        <tt:Device>
          <tt:XAddr>${serviceUrl}/device_service</tt:XAddr>
        </tt:Device>
        <tt:Media>
          <tt:XAddr>${serviceUrl}/media_service</tt:XAddr>
          <tt:StreamingCapabilities>
            <tt:RTPMulticast>false</tt:RTPMulticast>
            <tt:RTP_TCP>true</tt:RTP_TCP>
            <tt:RTP_RTSP_TCP>true</tt:RTP_RTSP_TCP>
          </tt:StreamingCapabilities>
        </tt:Media>${ptzCapXml}${eventsCapXml}
      </tds:Capabilities>
    </tds:GetCapabilitiesResponse>`);
    }
    getServices() {
        const serviceUrl = `http://${this.serviceIp}:${this.servicePort}/onvif`;
        const caps = this.config.capabilities;
        let services = `
      <tds:Service>
        <tds:Namespace>${ONVIF_DEVICE_NS}</tds:Namespace>
        <tds:XAddr>${serviceUrl}/device_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>0</tt:Minor></tds:Version>
      </tds:Service>
      <tds:Service>
        <tds:Namespace>${ONVIF_MEDIA_NS}</tds:Namespace>
        <tds:XAddr>${serviceUrl}/media_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>0</tt:Minor></tds:Version>
      </tds:Service>`;
        if (caps.hasPtz) {
            services += `
      <tds:Service>
        <tds:Namespace>${ONVIF_PTZ_NS}</tds:Namespace>
        <tds:XAddr>${serviceUrl}/ptz_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>0</tt:Minor></tds:Version>
      </tds:Service>`;
        }
        if (caps.hasMotionSensor ||
            caps.hasAudioSensor ||
            caps.hasObjectDetection) {
            services += `
      <tds:Service>
        <tds:Namespace>${ONVIF_EVENT_NS}</tds:Namespace>
        <tds:XAddr>${serviceUrl}/event_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>0</tt:Minor></tds:Version>
      </tds:Service>`;
        }
        return soapEnvelope(`
    <tds:GetServicesResponse>${services}
    </tds:GetServicesResponse>`);
    }
    getSystemDateAndTime() {
        const now = new Date();
        return soapEnvelope(`
    <tds:GetSystemDateAndTimeResponse>
      <tds:SystemDateAndTime>
        <tt:DateTimeType>NTP</tt:DateTimeType>
        <tt:DaylightSavings>false</tt:DaylightSavings>
        <tt:UTCDateTime>
          <tt:Time>
            <tt:Hour>${now.getUTCHours()}</tt:Hour>
            <tt:Minute>${now.getUTCMinutes()}</tt:Minute>
            <tt:Second>${now.getUTCSeconds()}</tt:Second>
          </tt:Time>
          <tt:Date>
            <tt:Year>${now.getUTCFullYear()}</tt:Year>
            <tt:Month>${now.getUTCMonth() + 1}</tt:Month>
            <tt:Day>${now.getUTCDate()}</tt:Day>
          </tt:Date>
        </tt:UTCDateTime>
      </tds:SystemDateAndTime>
    </tds:GetSystemDateAndTimeResponse>`);
    }
    getScopes() {
        const name = encodeURIComponent(this.config.deviceName);
        const caps = this.config.capabilities;
        let scopes = `
      <tds:Scopes>
        <tt:ScopeDef>Fixed</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/type/video_encoder</tt:ScopeItem>
      </tds:Scopes>
      <tds:Scopes>
        <tt:ScopeDef>Fixed</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/type/network_video_transmitter</tt:ScopeItem>
      </tds:Scopes>
      <tds:Scopes>
        <tt:ScopeDef>Configurable</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/name/${name}</tt:ScopeItem>
      </tds:Scopes>
      <tds:Scopes>
        <tt:ScopeDef>Fixed</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/hardware/${this.escXml(this.config.model)}</tt:ScopeItem>
      </tds:Scopes>
      <tds:Scopes>
        <tt:ScopeDef>Fixed</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/Profile/Streaming</tt:ScopeItem>
      </tds:Scopes>`;
        if (caps.hasPtz) {
            scopes += `
      <tds:Scopes>
        <tt:ScopeDef>Fixed</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/type/ptz</tt:ScopeItem>
      </tds:Scopes>`;
        }
        if (caps.hasIntercom) {
            scopes += `
      <tds:Scopes>
        <tt:ScopeDef>Fixed</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/type/audio_encoder</tt:ScopeItem>
      </tds:Scopes>`;
        }
        if (caps.hasIntercom) {
            scopes += `
      <tds:Scopes>
        <tt:ScopeDef>Fixed</tt:ScopeDef>
        <tt:ScopeItem>onvif://www.onvif.org/type/audio_decoder</tt:ScopeItem>
      </tds:Scopes>`;
        }
        return soapEnvelope(`
    <tds:GetScopesResponse>${scopes}
    </tds:GetScopesResponse>`);
    }
    getNetworkInterfaces() {
        // Generate a deterministic unique MAC per camera so NVRs like UniFi
        // identify each camera as a separate physical device.
        const mac = this.generateMac();
        return soapEnvelope(`
    <tds:GetNetworkInterfacesResponse>
      <tds:NetworkInterfaces token="eth0">
        <tt:Enabled>true</tt:Enabled>
        <tt:Info>
          <tt:Name>eth0</tt:Name>
          <tt:HwAddress>${mac}</tt:HwAddress>
        </tt:Info>
        <tt:IPv4>
          <tt:Enabled>true</tt:Enabled>
          <tt:Config>
            <tt:Manual>
              <tt:Address>${this.serviceIp}</tt:Address>
              <tt:PrefixLength>24</tt:PrefixLength>
            </tt:Manual>
            <tt:DHCP>false</tt:DHCP>
          </tt:Config>
        </tt:IPv4>
      </tds:NetworkInterfaces>
    </tds:GetNetworkInterfacesResponse>`);
    }
    /**
     * Generate a deterministic MAC address from the device ID.
     * Uses 02:xx:xx:xx:xx:xx range (locally administered, unicast).
     */
    generateMac() {
        const hash = crypto_1.default
            .createHash("md5")
            .update(`onvif-mac-${this.config.deviceId}`)
            .digest();
        const bytes = [0x02, hash[0], hash[1], hash[2], hash[3], hash[4]];
        return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
    }
    // ─── Media Service ───────────────────────────────────────────────
    getProfiles() {
        const caps = this.config.capabilities;
        const profiles = this.config.streams.map((stream, idx) => {
            const token = `profile_${idx}`;
            let audioSourceXml = "";
            let audioEncoderXml = "";
            if (caps.hasIntercom) {
                audioSourceXml = `
        <tt:AudioSourceConfiguration token="asrc_0">
          <tt:Name>AudioSource_0</tt:Name>
          <tt:UseCount>1</tt:UseCount>
          <tt:SourceToken>audio_src_0</tt:SourceToken>
        </tt:AudioSourceConfiguration>`;
                audioEncoderXml = `
        <tt:AudioEncoderConfiguration token="aenc_0">
          <tt:Name>AudioEncoder_0</tt:Name>
          <tt:UseCount>1</tt:UseCount>
          <tt:Encoding>AAC</tt:Encoding>
          <tt:Bitrate>64</tt:Bitrate>
          <tt:SampleRate>16</tt:SampleRate>
        </tt:AudioEncoderConfiguration>`;
            }
            let audioOutputXml = "";
            let audioDecoderXml = "";
            if (caps.hasIntercom) {
                audioOutputXml = `
        <tt:AudioOutputConfiguration token="aout_0">
          <tt:Name>AudioOutput_0</tt:Name>
          <tt:UseCount>1</tt:UseCount>
          <tt:OutputToken>audio_out_0</tt:OutputToken>
          <tt:OutputLevel>50</tt:OutputLevel>
        </tt:AudioOutputConfiguration>`;
                audioDecoderXml = `
        <tt:AudioDecoderConfiguration token="adec_0">
          <tt:Name>AudioDecoder_0</tt:Name>
          <tt:UseCount>1</tt:UseCount>
        </tt:AudioDecoderConfiguration>`;
            }
            let ptzConfigXml = "";
            if (caps.hasPtz) {
                ptzConfigXml = `
        <tt:PTZConfiguration token="ptz_config_0">
          <tt:Name>PTZ_0</tt:Name>
          <tt:UseCount>1</tt:UseCount>
          <tt:NodeToken>ptz_node_0</tt:NodeToken>
          <tt:DefaultAbsolutePantable>true</tt:DefaultAbsolutePantable>
          <tt:DefaultRelativePanTiltTranslationSpace>http://www.onvif.org/ver10/tptz/PanTiltSpaces/TranslationGenericSpace</tt:DefaultRelativePanTiltTranslationSpace>
          <tt:DefaultRelativeZoomTranslationSpace>http://www.onvif.org/ver10/tptz/ZoomSpaces/TranslationGenericSpace</tt:DefaultRelativeZoomTranslationSpace>
          <tt:DefaultContinuousPanTiltVelocitySpace>http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocityGenericSpace</tt:DefaultContinuousPanTiltVelocitySpace>
          <tt:DefaultContinuousZoomVelocitySpace>http://www.onvif.org/ver10/tptz/ZoomSpaces/VelocityGenericSpace</tt:DefaultContinuousZoomVelocitySpace>
          <tt:DefaultPTZTimeout>PT10S</tt:DefaultPTZTimeout>
        </tt:PTZConfiguration>`;
            }
            return `
      <trt:Profiles token="${token}" fixed="true">
        <tt:Name>${this.escXml(stream.name)}</tt:Name>
        <tt:VideoSourceConfiguration token="vsrc_${idx}">
          <tt:Name>VideoSource_${idx}</tt:Name>
          <tt:UseCount>1</tt:UseCount>
          <tt:SourceToken>video_src_${idx}</tt:SourceToken>
          <tt:Bounds x="0" y="0" width="${stream.width ?? 1920}" height="${stream.height ?? 1080}"/>
        </tt:VideoSourceConfiguration>
        <tt:VideoEncoderConfiguration token="venc_${idx}">
          <tt:Name>${this.escXml(stream.name)}</tt:Name>
          <tt:UseCount>1</tt:UseCount>
          <tt:Encoding>H264</tt:Encoding>
          <tt:Resolution>
            <tt:Width>${stream.width ?? 1920}</tt:Width>
            <tt:Height>${stream.height ?? 1080}</tt:Height>
          </tt:Resolution>
          <tt:RateControl>
            <tt:FrameRateLimit>25</tt:FrameRateLimit>
            <tt:BitrateLimit>4096</tt:BitrateLimit>
          </tt:RateControl>
        </tt:VideoEncoderConfiguration>${audioSourceXml}${audioEncoderXml}${audioOutputXml}${audioDecoderXml}${ptzConfigXml}
      </trt:Profiles>`;
        });
        return soapEnvelope(`
    <trt:GetProfilesResponse>${profiles.join("")}
    </trt:GetProfilesResponse>`);
    }
    getStreamUri(body) {
        const profileToken = this.extractValue(body, "ProfileToken");
        const stream = this.getStreamByProfileToken(profileToken);
        if (!stream) {
            return this.soapFault("Sender", `Profile ${profileToken} not found`);
        }
        return soapEnvelope(`
    <trt:GetStreamUriResponse>
      <trt:MediaUri>
        <tt:Uri>${this.escXml(stream.rtspUrl)}</tt:Uri>
        <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
        <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
        <tt:Timeout>PT60S</tt:Timeout>
      </trt:MediaUri>
    </trt:GetStreamUriResponse>`);
    }
    getSnapshotUri(body) {
        const snapshotUrl = this.config.getSnapshot
            ? `http://${this.serviceIp}:${this.servicePort}/snapshot`
            : "";
        return soapEnvelope(`
    <trt:GetSnapshotUriResponse>
      <trt:MediaUri>
        <tt:Uri>${snapshotUrl}</tt:Uri>
        <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
        <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
        <tt:Timeout>PT60S</tt:Timeout>
      </trt:MediaUri>
    </trt:GetSnapshotUriResponse>`);
    }
    getVideoSources() {
        const sources = this.config.streams.map((stream, idx) => `
      <trt:VideoSources token="video_src_${idx}">
        <tt:Framerate>25</tt:Framerate>
        <tt:Resolution>
          <tt:Width>${stream.width ?? 1920}</tt:Width>
          <tt:Height>${stream.height ?? 1080}</tt:Height>
        </tt:Resolution>
      </trt:VideoSources>`);
        return soapEnvelope(`
    <trt:GetVideoSourcesResponse>${sources.join("")}
    </trt:GetVideoSourcesResponse>`);
    }
    getVideoSourceConfigurations() {
        const configs = this.config.streams.map((stream, idx) => `
      <trt:Configurations token="vsrc_${idx}">
        <tt:Name>VideoSource_${idx}</tt:Name>
        <tt:UseCount>1</tt:UseCount>
        <tt:SourceToken>video_src_${idx}</tt:SourceToken>
        <tt:Bounds x="0" y="0" width="${stream.width ?? 1920}" height="${stream.height ?? 1080}"/>
      </trt:Configurations>`);
        return soapEnvelope(`
    <trt:GetVideoSourceConfigurationsResponse>${configs.join("")}
    </trt:GetVideoSourceConfigurationsResponse>`);
    }
    getVideoEncoderConfigurations() {
        const configs = this.config.streams.map((stream, idx) => `
      <trt:Configurations token="venc_${idx}">
        <tt:Name>${this.escXml(stream.name)}</tt:Name>
        <tt:UseCount>1</tt:UseCount>
        <tt:Encoding>H264</tt:Encoding>
        <tt:Resolution>
          <tt:Width>${stream.width ?? 1920}</tt:Width>
          <tt:Height>${stream.height ?? 1080}</tt:Height>
        </tt:Resolution>
        <tt:RateControl>
          <tt:FrameRateLimit>25</tt:FrameRateLimit>
          <tt:BitrateLimit>4096</tt:BitrateLimit>
        </tt:RateControl>
      </trt:Configurations>`);
        return soapEnvelope(`
    <trt:GetVideoEncoderConfigurationsResponse>${configs.join("")}
    </trt:GetVideoEncoderConfigurationsResponse>`);
    }
    // ─── Audio Sources & Outputs ─────────────────────────────────────
    getAudioSources() {
        const caps = this.config.capabilities;
        if (!caps.hasIntercom) {
            return soapEnvelope(`<trt:GetAudioSourcesResponse/>`);
        }
        return soapEnvelope(`
    <trt:GetAudioSourcesResponse>
      <trt:AudioSources token="audio_src_0">
        <tt:Channels>1</tt:Channels>
      </trt:AudioSources>
    </trt:GetAudioSourcesResponse>`);
    }
    getAudioSourceConfigurations() {
        const caps = this.config.capabilities;
        if (!caps.hasIntercom) {
            return soapEnvelope(`<trt:GetAudioSourceConfigurationsResponse/>`);
        }
        return soapEnvelope(`
    <trt:GetAudioSourceConfigurationsResponse>
      <trt:Configurations token="asrc_0">
        <tt:Name>AudioSource_0</tt:Name>
        <tt:UseCount>1</tt:UseCount>
        <tt:SourceToken>audio_src_0</tt:SourceToken>
      </trt:Configurations>
    </trt:GetAudioSourceConfigurationsResponse>`);
    }
    getAudioEncoderConfigurations() {
        const caps = this.config.capabilities;
        if (!caps.hasIntercom) {
            return soapEnvelope(`<trt:GetAudioEncoderConfigurationsResponse/>`);
        }
        return soapEnvelope(`
    <trt:GetAudioEncoderConfigurationsResponse>
      <trt:Configurations token="aenc_0">
        <tt:Name>AudioEncoder_0</tt:Name>
        <tt:UseCount>1</tt:UseCount>
        <tt:Encoding>AAC</tt:Encoding>
        <tt:Bitrate>64</tt:Bitrate>
        <tt:SampleRate>16</tt:SampleRate>
      </trt:Configurations>
    </trt:GetAudioEncoderConfigurationsResponse>`);
    }
    getAudioOutputs() {
        if (!this.config.capabilities.hasIntercom) {
            return soapEnvelope(`<trt:GetAudioOutputsResponse/>`);
        }
        return soapEnvelope(`
    <trt:GetAudioOutputsResponse>
      <trt:AudioOutputs token="audio_out_0">
        <tt:Channels>1</tt:Channels>
      </trt:AudioOutputs>
    </trt:GetAudioOutputsResponse>`);
    }
    getAudioOutputConfigurations() {
        if (!this.config.capabilities.hasIntercom) {
            return soapEnvelope(`<trt:GetAudioOutputConfigurationsResponse/>`);
        }
        return soapEnvelope(`
    <trt:GetAudioOutputConfigurationsResponse>
      <trt:Configurations token="aout_0">
        <tt:Name>AudioOutput_0</tt:Name>
        <tt:UseCount>1</tt:UseCount>
        <tt:OutputToken>audio_out_0</tt:OutputToken>
        <tt:OutputLevel>50</tt:OutputLevel>
      </trt:Configurations>
    </trt:GetAudioOutputConfigurationsResponse>`);
    }
    getAudioDecoderConfigurations() {
        if (!this.config.capabilities.hasIntercom) {
            return soapEnvelope(`<trt:GetAudioDecoderConfigurationsResponse/>`);
        }
        return soapEnvelope(`
    <trt:GetAudioDecoderConfigurationsResponse>
      <trt:Configurations token="adec_0">
        <tt:Name>AudioDecoder_0</tt:Name>
        <tt:UseCount>1</tt:UseCount>
      </trt:Configurations>
    </trt:GetAudioDecoderConfigurationsResponse>`);
    }
    // ─── PTZ Service ─────────────────────────────────────────────────
    getPtzConfigurations() {
        if (!this.config.capabilities.hasPtz) {
            return soapEnvelope(`<tptz:GetConfigurationsResponse/>`);
        }
        return soapEnvelope(`
    <tptz:GetConfigurationsResponse>
      <tptz:PTZConfiguration token="ptz_config_0">
        <tt:Name>PTZ_0</tt:Name>
        <tt:UseCount>1</tt:UseCount>
        <tt:NodeToken>ptz_node_0</tt:NodeToken>
        <tt:DefaultContinuousPanTiltVelocitySpace>http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocityGenericSpace</tt:DefaultContinuousPanTiltVelocitySpace>
        <tt:DefaultContinuousZoomVelocitySpace>http://www.onvif.org/ver10/tptz/ZoomSpaces/VelocityGenericSpace</tt:DefaultContinuousZoomVelocitySpace>
        <tt:DefaultPTZTimeout>PT10S</tt:DefaultPTZTimeout>
      </tptz:PTZConfiguration>
    </tptz:GetConfigurationsResponse>`);
    }
    getPtzConfiguration(body) {
        return this.getPtzConfigurations();
    }
    getPtzNodes() {
        if (!this.config.capabilities.hasPtz) {
            return soapEnvelope(`<tptz:GetNodesResponse/>`);
        }
        const ptz = this.config.capabilities.ptzCapabilities;
        const pan = ptz?.pan !== false;
        const tilt = ptz?.tilt !== false;
        const zoom = ptz?.zoom !== false;
        let panTiltSpaces = "";
        if (pan || tilt) {
            panTiltSpaces = `
          <tt:AbsolutePanTiltPositionSpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/PanTiltSpaces/PositionGenericSpace</tt:URI>
            <tt:XRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:XRange>
            <tt:YRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:YRange>
          </tt:AbsolutePanTiltPositionSpace>
          <tt:RelativePanTiltTranslationSpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/PanTiltSpaces/TranslationGenericSpace</tt:URI>
            <tt:XRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:XRange>
            <tt:YRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:YRange>
          </tt:RelativePanTiltTranslationSpace>
          <tt:ContinuousPanTiltVelocitySpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocityGenericSpace</tt:URI>
            <tt:XRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:XRange>
            <tt:YRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:YRange>
          </tt:ContinuousPanTiltVelocitySpace>
          <tt:PanTiltSpeedSpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/PanTiltSpaces/GenericSpeedSpace</tt:URI>
            <tt:XRange><tt:Min>0</tt:Min><tt:Max>1</tt:Max></tt:XRange>
          </tt:PanTiltSpeedSpace>`;
        }
        let zoomSpaces = "";
        if (zoom) {
            zoomSpaces = `
          <tt:AbsoluteZoomPositionSpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/ZoomSpaces/PositionGenericSpace</tt:URI>
            <tt:XRange><tt:Min>0</tt:Min><tt:Max>1</tt:Max></tt:XRange>
          </tt:AbsoluteZoomPositionSpace>
          <tt:RelativeZoomTranslationSpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/ZoomSpaces/TranslationGenericSpace</tt:URI>
            <tt:XRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:XRange>
          </tt:RelativeZoomTranslationSpace>
          <tt:ContinuousZoomVelocitySpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/ZoomSpaces/VelocityGenericSpace</tt:URI>
            <tt:XRange><tt:Min>-1</tt:Min><tt:Max>1</tt:Max></tt:XRange>
          </tt:ContinuousZoomVelocitySpace>
          <tt:ZoomSpeedSpace>
            <tt:URI>http://www.onvif.org/ver10/tptz/ZoomSpaces/ZoomGenericSpeedSpace</tt:URI>
            <tt:XRange><tt:Min>0</tt:Min><tt:Max>1</tt:Max></tt:XRange>
          </tt:ZoomSpeedSpace>`;
        }
        return soapEnvelope(`
    <tptz:GetNodesResponse>
      <tptz:PTZNode token="ptz_node_0" FixedHomePosition="false">
        <tt:Name>PTZ Node</tt:Name>
        <tt:SupportedPTZSpaces>${panTiltSpaces}${zoomSpaces}
        </tt:SupportedPTZSpaces>
        <tt:MaximumNumberOfPresets>16</tt:MaximumNumberOfPresets>
        <tt:HomeSupported>true</tt:HomeSupported>
      </tptz:PTZNode>
    </tptz:GetNodesResponse>`);
    }
    getPtzNode(body) {
        return this.getPtzNodes();
    }
    ptzContinuousMove(body) {
        if (!this.config.capabilities.hasPtz) {
            return this.soapFault("Sender", "PTZ not supported");
        }
        // Log the PTZ command — actual movement is handled by the Scrypted device
        this.console.log(`PTZ ContinuousMove request for ${this.config.deviceName}`);
        return soapEnvelope(`<tptz:ContinuousMoveResponse/>`);
    }
    ptzAbsoluteMove(body) {
        if (!this.config.capabilities.hasPtz) {
            return this.soapFault("Sender", "PTZ not supported");
        }
        this.console.log(`PTZ AbsoluteMove request for ${this.config.deviceName}`);
        return soapEnvelope(`<tptz:AbsoluteMoveResponse/>`);
    }
    ptzRelativeMove(body) {
        if (!this.config.capabilities.hasPtz) {
            return this.soapFault("Sender", "PTZ not supported");
        }
        this.console.log(`PTZ RelativeMove request for ${this.config.deviceName}`);
        return soapEnvelope(`<tptz:RelativeMoveResponse/>`);
    }
    ptzStop(body) {
        if (!this.config.capabilities.hasPtz) {
            return this.soapFault("Sender", "PTZ not supported");
        }
        this.console.log(`PTZ Stop request for ${this.config.deviceName}`);
        return soapEnvelope(`<tptz:StopResponse/>`);
    }
    ptzGotoHome(body) {
        if (!this.config.capabilities.hasPtz) {
            return this.soapFault("Sender", "PTZ not supported");
        }
        this.console.log(`PTZ GotoHome request for ${this.config.deviceName}`);
        return soapEnvelope(`<tptz:GotoHomePositionResponse/>`);
    }
    ptzGotoPreset(body) {
        if (!this.config.capabilities.hasPtz) {
            return this.soapFault("Sender", "PTZ not supported");
        }
        const presetToken = this.extractValue(body, "PresetToken");
        this.console.log(`PTZ GotoPreset ${presetToken} request for ${this.config.deviceName}`);
        return soapEnvelope(`<tptz:GotoPresetResponse/>`);
    }
    ptzGetPresets(body) {
        if (!this.config.capabilities.hasPtz) {
            return soapEnvelope(`<tptz:GetPresetsResponse/>`);
        }
        // Return empty presets — real presets would come from the Scrypted device
        return soapEnvelope(`<tptz:GetPresetsResponse/>`);
    }
    ptzGetStatus(body) {
        if (!this.config.capabilities.hasPtz) {
            return this.soapFault("Sender", "PTZ not supported");
        }
        return soapEnvelope(`
    <tptz:GetStatusResponse>
      <tptz:PTZStatus>
        <tt:Position>
          <tt:PanTilt x="0" y="0" space="http://www.onvif.org/ver10/tptz/PanTiltSpaces/PositionGenericSpace"/>
          <tt:Zoom x="0" space="http://www.onvif.org/ver10/tptz/ZoomSpaces/PositionGenericSpace"/>
        </tt:Position>
        <tt:MoveStatus>
          <tt:PanTilt>IDLE</tt:PanTilt>
          <tt:Zoom>IDLE</tt:Zoom>
        </tt:MoveStatus>
        <tt:UtcTime>${new Date().toISOString()}</tt:UtcTime>
      </tptz:PTZStatus>
    </tptz:GetStatusResponse>`);
    }
    // ─── Event Service ───────────────────────────────────────────────
    getEventProperties() {
        const caps = this.config.capabilities;
        let topics = "";
        if (caps.hasMotionSensor) {
            topics += `
        <tev:TopicSet>
          <tt:RuleEngine>
            <tt:CellMotionDetector>
              <tt:Motion wstop:topic="true" xmlns:wstop="http://docs.oasis-open.org/wsn/t-1"/>
            </tt:CellMotionDetector>
          </tt:RuleEngine>
          <tt:VideoSource>
            <tt:MotionAlarm wstop:topic="true" xmlns:wstop="http://docs.oasis-open.org/wsn/t-1"/>
          </tt:VideoSource>
        </tev:TopicSet>`;
        }
        if (caps.hasAudioSensor) {
            topics += `
        <tev:TopicSet>
          <tt:AudioAnalytics>
            <tt:Audio>
              <tt:DetectedSound wstop:topic="true" xmlns:wstop="http://docs.oasis-open.org/wsn/t-1"/>
            </tt:Audio>
          </tt:AudioAnalytics>
        </tev:TopicSet>`;
        }
        if (caps.hasObjectDetection) {
            topics += `
        <tev:TopicSet>
          <tt:RuleEngine>
            <tt:ObjectDetector>
              <tt:ObjectDetection wstop:topic="true" xmlns:wstop="http://docs.oasis-open.org/wsn/t-1"/>
            </tt:ObjectDetection>
          </tt:RuleEngine>
        </tev:TopicSet>`;
        }
        return soapEnvelope(`
    <tev:GetEventPropertiesResponse>
      <tev:TopicNamespaceLocation>http://www.onvif.org/ver10/topics/topicns.xml</tev:TopicNamespaceLocation>
      <tev:FixedTopicSet>true</tev:FixedTopicSet>${topics}
      <tev:TopicExpressionDialect>http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet</tev:TopicExpressionDialect>
      <tev:MessageContentFilterDialect>http://www.onvif.org/ver10/tev/messageContentFilter/ItemFilter</tev:MessageContentFilterDialect>
    </tev:GetEventPropertiesResponse>`);
    }
    getEventServiceCapabilities() {
        return soapEnvelope(`
    <tev:GetServiceCapabilitiesResponse>
      <tev:Capabilities WSSubscriptionPolicySupport="false"
                         WSPullPointSupport="true"
                         WSPausableSubscriptionManagerInterfaceSupport="false"/>
    </tev:GetServiceCapabilitiesResponse>`);
    }
    startSubscriptionCleanup() {
        this.stopSubscriptionCleanup();
        this.subscriptionCleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [id, sub] of this.subscriptions) {
                if (sub.terminationTime.getTime() < now) {
                    this.subscriptions.delete(id);
                }
            }
            // Also clean expired digest nonces
            for (const [nonce, expiry] of this.digestNonces) {
                if (expiry < now)
                    this.digestNonces.delete(nonce);
            }
        }, SUBSCRIPTION_CLEANUP_INTERVAL_MS);
    }
    stopSubscriptionCleanup() {
        if (this.subscriptionCleanupTimer) {
            clearInterval(this.subscriptionCleanupTimer);
            this.subscriptionCleanupTimer = null;
        }
    }
    createPullPointSubscription() {
        // Cap subscriptions to prevent memory exhaustion
        if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) {
            // Evict oldest subscription
            const oldest = this.subscriptions.keys().next().value;
            if (oldest)
                this.subscriptions.delete(oldest);
        }
        const subId = (0, uuid_1.v4)();
        const now = new Date();
        const terminationTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
        this.subscriptions.set(subId, {
            id: subId,
            events: [],
            createdAt: now,
            terminationTime,
        });
        this.console.log(`PullPoint subscription created: ${subId} for ${this.config.deviceName}`);
        const serviceUrl = `http://${this.serviceIp}:${this.servicePort}/onvif/event_service`;
        return soapEnvelope(`
    <tev:CreatePullPointSubscriptionResponse>
      <tev:SubscriptionReference>
        <a:Address xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">${serviceUrl}?sub=${subId}</a:Address>
      </tev:SubscriptionReference>
      <tev:CurrentTime>${now.toISOString()}</tev:CurrentTime>
      <tev:TerminationTime>${terminationTime.toISOString()}</tev:TerminationTime>
    </tev:CreatePullPointSubscriptionResponse>`);
    }
    pullMessages(body) {
        // Try to find the subscription ID from the request URL or body
        const subId = this.findSubscriptionId(body);
        const sub = subId
            ? this.subscriptions.get(subId)
            : this.subscriptions.values().next().value;
        const now = new Date();
        const terminationTime = new Date(now.getTime() + 60 * 60 * 1000);
        if (!sub) {
            return soapEnvelope(`
    <tev:PullMessagesResponse>
      <tev:CurrentTime>${now.toISOString()}</tev:CurrentTime>
      <tev:TerminationTime>${terminationTime.toISOString()}</tev:TerminationTime>
    </tev:PullMessagesResponse>`);
        }
        // Drain pending events
        const events = sub.events.splice(0);
        sub.terminationTime = terminationTime;
        const notificationMessages = events.map((event) => {
            const dataItems = Object.entries(event.data)
                .map(([key, value]) => {
                const simpleItem = typeof value === "boolean"
                    ? `<tt:SimpleItem Name="${key}" Value="${value}"/>`
                    : typeof value === "number"
                        ? `<tt:SimpleItem Name="${key}" Value="${value}"/>`
                        : `<tt:SimpleItem Name="${key}" Value="${this.escXml(String(value))}"/>`;
                return simpleItem;
            })
                .join("\n              ");
            return `
      <wsnt:NotificationMessage xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
        <wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">${event.topic}</wsnt:Topic>
        <wsnt:Message>
          <tt:Message UtcTime="${event.timestamp.toISOString()}" PropertyOperation="Changed">
            <tt:Source>
              <tt:SimpleItem Name="Source" Value="${this.escXml(event.source)}"/>
            </tt:Source>
            <tt:Data>
              ${dataItems}
            </tt:Data>
          </tt:Message>
        </wsnt:Message>
      </wsnt:NotificationMessage>`;
        });
        return soapEnvelope(`
    <tev:PullMessagesResponse>
      <tev:CurrentTime>${now.toISOString()}</tev:CurrentTime>
      <tev:TerminationTime>${terminationTime.toISOString()}</tev:TerminationTime>${notificationMessages.join("")}
    </tev:PullMessagesResponse>`);
    }
    unsubscribe(body) {
        const subId = this.findSubscriptionId(body);
        if (subId) {
            this.subscriptions.delete(subId);
            this.console.log(`PullPoint subscription removed: ${subId}`);
        }
        return soapEnvelope(`<tev:UnsubscribeResponse/>`);
    }
    renewSubscription(body) {
        const subId = this.findSubscriptionId(body);
        const sub = subId ? this.subscriptions.get(subId) : undefined;
        const now = new Date();
        const terminationTime = new Date(now.getTime() + 60 * 60 * 1000);
        if (sub) {
            sub.terminationTime = terminationTime;
        }
        return soapEnvelope(`
    <tev:RenewResponse>
      <tev:CurrentTime>${now.toISOString()}</tev:CurrentTime>
      <tev:TerminationTime>${terminationTime.toISOString()}</tev:TerminationTime>
    </tev:RenewResponse>`);
    }
    /**
     * Try to extract the subscription ID from the SOAP body or the To header.
     */
    findSubscriptionId(body) {
        // Look in Address or To header for ?sub=<uuid>
        const subMatch = body.match(/[?&]sub=([a-f0-9-]+)/i);
        if (subMatch)
            return subMatch[1];
        // Fall back to first subscription
        return null;
    }
    // ─── WS-Discovery ────────────────────────────────────────────────
    startDiscovery() {
        try {
            // Listener socket: receives multicast probes on 0.0.0.0:3702
            this.discoverySocket = dgram_1.default.createSocket({
                type: "udp4",
                reuseAddr: true,
            });
            this.discoverySocket.on("error", (err) => {
                this.console.warn(`WS-Discovery socket error for ${this.config.deviceName}: ${err.message}`);
            });
            this.discoverySocket.on("message", (msg, rinfo) => {
                const message = msg.toString();
                if (message.includes("Probe") &&
                    message.includes("NetworkVideoTransmitter")) {
                    const messageIdMatch = message.match(/<[^>]*MessageID[^>]*>([^<]+)<\//);
                    const probeMessageId = messageIdMatch?.[1] ?? `urn:uuid:${(0, uuid_1.v4)()}`;
                    this.sendProbeMatch(rinfo, probeMessageId);
                }
            });
            this.discoverySocket.bind(WS_DISCOVERY_PORT, () => {
                try {
                    this.discoverySocket.addMembership(WS_DISCOVERY_ADDR);
                    this.console.log(`WS-Discovery active for ${this.config.deviceName}`);
                }
                catch (e) {
                    this.console.warn(`Failed to join multicast group: ${e.message}`);
                }
            });
            // Response socket: bound to this camera's unique IP so ProbeMatch
            // packets have the correct source address. NVRs like UniFi identify
            // cameras by the source IP of the UDP response, not the XML content.
            if (this.config.onvifIp && !this.config.proxyMode) {
                this.responseSocket = dgram_1.default.createSocket({
                    type: "udp4",
                    reuseAddr: true,
                });
                this.responseSocket.on("error", (err) => {
                    this.console.warn(`Response socket error for ${this.config.deviceName}: ${err.message}`);
                });
                this.responseSocket.bind(0, this.config.onvifIp, () => {
                    this.console.log(`WS-Discovery response socket bound to ${this.config.onvifIp} for ${this.config.deviceName}`);
                });
            }
        }
        catch (e) {
            this.console.warn(`Failed to start WS-Discovery for ${this.config.deviceName}: ${e.message}`);
        }
    }
    stopDiscovery() {
        if (this.discoverySocket) {
            try {
                this.sendBye();
            }
            catch {
                /* ignore */
            }
            try {
                this.discoverySocket.close();
            }
            catch {
                /* ignore */
            }
            this.discoverySocket = null;
        }
        if (this.responseSocket) {
            try {
                this.responseSocket.close();
            }
            catch {
                /* ignore */
            }
            this.responseSocket = null;
        }
    }
    sendBye() {
        if (!this.discoverySocket)
            return;
        const bye = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
    xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
    xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Bye</a:Action>
    <a:MessageID>urn:uuid:${(0, uuid_1.v4)()}</a:MessageID>
    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Bye>
      <a:EndpointReference>
        <a:Address>${this.deviceUuid}</a:Address>
      </a:EndpointReference>
    </d:Bye>
  </s:Body>
</s:Envelope>`;
        const buf = Buffer.from(bye);
        // Send from camera-specific IP if available, otherwise use discovery socket
        const sock = this.responseSocket || this.discoverySocket;
        sock.send(buf, 0, buf.length, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDR, (err) => {
            if (err) {
                this.console.warn(`Failed to send Bye: ${err.message}`);
            }
        });
    }
    sendProbeMatch(rinfo, probeMessageId) {
        const serviceUrl = `http://${this.serviceIp}:${this.servicePort}/onvif/device_service`;
        const name = encodeURIComponent(this.config.deviceName);
        const scopes = [
            "onvif://www.onvif.org/type/video_encoder",
            "onvif://www.onvif.org/type/network_video_transmitter",
            `onvif://www.onvif.org/name/${name}`,
            `onvif://www.onvif.org/hardware/${this.escXml(this.config.model)}`,
            "onvif://www.onvif.org/Profile/Streaming",
        ];
        if (this.config.capabilities.hasPtz) {
            scopes.push("onvif://www.onvif.org/type/ptz");
        }
        if (this.config.capabilities.hasIntercom) {
            scopes.push("onvif://www.onvif.org/type/audio_encoder");
        }
        if (this.config.capabilities.hasIntercom) {
            scopes.push("onvif://www.onvif.org/type/audio_decoder");
        }
        const response = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
    xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
    xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
    xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</a:Action>
    <a:RelatesTo>${probeMessageId}</a:RelatesTo>
    <a:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:To>
  </s:Header>
  <s:Body>
    <d:ProbeMatches>
      <d:ProbeMatch>
        <a:EndpointReference>
          <a:Address>${this.deviceUuid}</a:Address>
        </a:EndpointReference>
        <d:Types>dn:NetworkVideoTransmitter</d:Types>
        <d:Scopes>${scopes.join(" ")}</d:Scopes>
        <d:XAddrs>${serviceUrl}</d:XAddrs>
        <d:MetadataVersion>1</d:MetadataVersion>
      </d:ProbeMatch>
    </d:ProbeMatches>
  </s:Body>
</s:Envelope>`;
        const buf = Buffer.from(response);
        // Send from camera-specific IP so the NVR sees the correct source address
        const sock = this.responseSocket || this.discoverySocket;
        sock?.send(buf, 0, buf.length, rinfo.port, rinfo.address, (err) => {
            if (err) {
                this.console.warn(`Failed to send ProbeMatch: ${err.message}`);
            }
            else {
                this.console.log(`Sent ProbeMatch from ${this.serviceIp} to ${rinfo.address}:${rinfo.port} for ${this.config.deviceName}`);
            }
        });
    }
    // ─── Helpers ─────────────────────────────────────────────────────
    getStreamByProfileToken(token) {
        if (!token)
            return this.config.streams[0] ?? null;
        const match = token.match(/profile_(\d+)/);
        if (match) {
            const idx = parseInt(match[1], 10);
            return this.config.streams[idx] ?? null;
        }
        return this.config.streams[0] ?? null;
    }
    extractValue(xml, tag) {
        // Escape regex metacharacters in tag name to prevent ReDoS
        const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Match tag with optional namespace prefix, ensuring exact tag name
        const regex = new RegExp(`<(?:\\w+:)?${safeTag}(?:\\s[^>]*)?>([^<]*)<`, "i");
        const match = xml.match(regex);
        return match?.[1]?.trim() ?? "";
    }
    escXml(s) {
        return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    soapFault(code, reason) {
        return soapEnvelope(`
    <s:Fault>
      <s:Code><s:Value>s:${code}</s:Value></s:Code>
      <s:Reason><s:Text xml:lang="en">${this.escXml(reason)}</s:Text></s:Reason>
    </s:Fault>`);
    }
}
exports.OnvifServer = OnvifServer;


/***/ },

/***/ "./node_modules/uuid/dist/esm-node/index.js"
/*!**************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/index.js ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NIL: () => (/* reexport safe */ _nil_js__WEBPACK_IMPORTED_MODULE_4__["default"]),
/* harmony export */   parse: () => (/* reexport safe */ _parse_js__WEBPACK_IMPORTED_MODULE_8__["default"]),
/* harmony export */   stringify: () => (/* reexport safe */ _stringify_js__WEBPACK_IMPORTED_MODULE_7__["default"]),
/* harmony export */   v1: () => (/* reexport safe */ _v1_js__WEBPACK_IMPORTED_MODULE_0__["default"]),
/* harmony export */   v3: () => (/* reexport safe */ _v3_js__WEBPACK_IMPORTED_MODULE_1__["default"]),
/* harmony export */   v4: () => (/* reexport safe */ _v4_js__WEBPACK_IMPORTED_MODULE_2__["default"]),
/* harmony export */   v5: () => (/* reexport safe */ _v5_js__WEBPACK_IMPORTED_MODULE_3__["default"]),
/* harmony export */   validate: () => (/* reexport safe */ _validate_js__WEBPACK_IMPORTED_MODULE_6__["default"]),
/* harmony export */   version: () => (/* reexport safe */ _version_js__WEBPACK_IMPORTED_MODULE_5__["default"])
/* harmony export */ });
/* harmony import */ var _v1_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./v1.js */ "./node_modules/uuid/dist/esm-node/v1.js");
/* harmony import */ var _v3_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./v3.js */ "./node_modules/uuid/dist/esm-node/v3.js");
/* harmony import */ var _v4_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./v4.js */ "./node_modules/uuid/dist/esm-node/v4.js");
/* harmony import */ var _v5_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./v5.js */ "./node_modules/uuid/dist/esm-node/v5.js");
/* harmony import */ var _nil_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./nil.js */ "./node_modules/uuid/dist/esm-node/nil.js");
/* harmony import */ var _version_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./version.js */ "./node_modules/uuid/dist/esm-node/version.js");
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-node/validate.js");
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-node/stringify.js");
/* harmony import */ var _parse_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./parse.js */ "./node_modules/uuid/dist/esm-node/parse.js");










/***/ },

/***/ "./node_modules/uuid/dist/esm-node/md5.js"
/*!************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/md5.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! crypto */ "crypto");
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(crypto__WEBPACK_IMPORTED_MODULE_0__);


function md5(bytes) {
  if (Array.isArray(bytes)) {
    bytes = Buffer.from(bytes);
  } else if (typeof bytes === 'string') {
    bytes = Buffer.from(bytes, 'utf8');
  }

  return crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('md5').update(bytes).digest();
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (md5);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/native.js"
/*!***************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/native.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! crypto */ "crypto");
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(crypto__WEBPACK_IMPORTED_MODULE_0__);

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ({
  randomUUID: (crypto__WEBPACK_IMPORTED_MODULE_0___default().randomUUID)
});

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/nil.js"
/*!************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/nil.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ('00000000-0000-0000-0000-000000000000');

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/parse.js"
/*!**************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/parse.js ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-node/validate.js");


function parse(uuid) {
  if (!(0,_validate_js__WEBPACK_IMPORTED_MODULE_0__["default"])(uuid)) {
    throw TypeError('Invalid UUID');
  }

  let v;
  const arr = new Uint8Array(16); // Parse ########-....-....-....-............

  arr[0] = (v = parseInt(uuid.slice(0, 8), 16)) >>> 24;
  arr[1] = v >>> 16 & 0xff;
  arr[2] = v >>> 8 & 0xff;
  arr[3] = v & 0xff; // Parse ........-####-....-....-............

  arr[4] = (v = parseInt(uuid.slice(9, 13), 16)) >>> 8;
  arr[5] = v & 0xff; // Parse ........-....-####-....-............

  arr[6] = (v = parseInt(uuid.slice(14, 18), 16)) >>> 8;
  arr[7] = v & 0xff; // Parse ........-....-....-####-............

  arr[8] = (v = parseInt(uuid.slice(19, 23), 16)) >>> 8;
  arr[9] = v & 0xff; // Parse ........-....-....-....-############
  // (Use "/" to avoid 32-bit truncation when bit-shifting high-order bytes)

  arr[10] = (v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000 & 0xff;
  arr[11] = v / 0x100000000 & 0xff;
  arr[12] = v >>> 24 & 0xff;
  arr[13] = v >>> 16 & 0xff;
  arr[14] = v >>> 8 & 0xff;
  arr[15] = v & 0xff;
  return arr;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (parse);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/regex.js"
/*!**************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/regex.js ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/rng.js"
/*!************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/rng.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ rng)
/* harmony export */ });
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! crypto */ "crypto");
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(crypto__WEBPACK_IMPORTED_MODULE_0__);

const rnds8Pool = new Uint8Array(256); // # of random values to pre-allocate

let poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto__WEBPACK_IMPORTED_MODULE_0___default().randomFillSync(rnds8Pool);
    poolPtr = 0;
  }

  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/sha1.js"
/*!*************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/sha1.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! crypto */ "crypto");
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(crypto__WEBPACK_IMPORTED_MODULE_0__);


function sha1(bytes) {
  if (Array.isArray(bytes)) {
    bytes = Buffer.from(bytes);
  } else if (typeof bytes === 'string') {
    bytes = Buffer.from(bytes, 'utf8');
  }

  return crypto__WEBPACK_IMPORTED_MODULE_0___default().createHash('sha1').update(bytes).digest();
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (sha1);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/stringify.js"
/*!******************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/stringify.js ***!
  \******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__),
/* harmony export */   unsafeStringify: () => (/* binding */ unsafeStringify)
/* harmony export */ });
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-node/validate.js");

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */

const byteToHex = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!(0,_validate_js__WEBPACK_IMPORTED_MODULE_0__["default"])(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (stringify);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/v1.js"
/*!***********************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/v1.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _rng_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./rng.js */ "./node_modules/uuid/dist/esm-node/rng.js");
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-node/stringify.js");

 // **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html

let _nodeId;

let _clockseq; // Previous uuid creation time


let _lastMSecs = 0;
let _lastNSecs = 0; // See https://github.com/uuidjs/uuid for API details

function v1(options, buf, offset) {
  let i = buf && offset || 0;
  const b = buf || new Array(16);
  options = options || {};
  let node = options.node || _nodeId;
  let clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq; // node and clockseq need to be initialized to random values if they're not
  // specified.  We do this lazily to minimize issues related to insufficient
  // system entropy.  See #189

  if (node == null || clockseq == null) {
    const seedBytes = options.random || (options.rng || _rng_js__WEBPACK_IMPORTED_MODULE_0__["default"])();

    if (node == null) {
      // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
      node = _nodeId = [seedBytes[0] | 0x01, seedBytes[1], seedBytes[2], seedBytes[3], seedBytes[4], seedBytes[5]];
    }

    if (clockseq == null) {
      // Per 4.2.2, randomize (14 bit) clockseq
      clockseq = _clockseq = (seedBytes[6] << 8 | seedBytes[7]) & 0x3fff;
    }
  } // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.


  let msecs = options.msecs !== undefined ? options.msecs : Date.now(); // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock

  let nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1; // Time since last uuid creation (in msecs)

  const dt = msecs - _lastMSecs + (nsecs - _lastNSecs) / 10000; // Per 4.2.1.2, Bump clockseq on clock regression

  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  } // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval


  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  } // Per 4.2.1.2 Throw error if too many uuids are requested


  if (nsecs >= 10000) {
    throw new Error("uuid.v1(): Can't create more than 10M uuids/sec");
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq; // Per 4.1.4 - Convert from unix epoch to Gregorian epoch

  msecs += 12219292800000; // `time_low`

  const tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff; // `time_mid`

  const tmh = msecs / 0x100000000 * 10000 & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff; // `time_high_and_version`

  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version

  b[i++] = tmh >>> 16 & 0xff; // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)

  b[i++] = clockseq >>> 8 | 0x80; // `clock_seq_low`

  b[i++] = clockseq & 0xff; // `node`

  for (let n = 0; n < 6; ++n) {
    b[i + n] = node[n];
  }

  return buf || (0,_stringify_js__WEBPACK_IMPORTED_MODULE_1__.unsafeStringify)(b);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v1);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/v3.js"
/*!***********************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/v3.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _v35_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./v35.js */ "./node_modules/uuid/dist/esm-node/v35.js");
/* harmony import */ var _md5_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./md5.js */ "./node_modules/uuid/dist/esm-node/md5.js");


const v3 = (0,_v35_js__WEBPACK_IMPORTED_MODULE_0__["default"])('v3', 0x30, _md5_js__WEBPACK_IMPORTED_MODULE_1__["default"]);
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v3);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/v35.js"
/*!************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/v35.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DNS: () => (/* binding */ DNS),
/* harmony export */   URL: () => (/* binding */ URL),
/* harmony export */   "default": () => (/* binding */ v35)
/* harmony export */ });
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-node/stringify.js");
/* harmony import */ var _parse_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./parse.js */ "./node_modules/uuid/dist/esm-node/parse.js");



function stringToBytes(str) {
  str = unescape(encodeURIComponent(str)); // UTF8 escape

  const bytes = [];

  for (let i = 0; i < str.length; ++i) {
    bytes.push(str.charCodeAt(i));
  }

  return bytes;
}

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
function v35(name, version, hashfunc) {
  function generateUUID(value, namespace, buf, offset) {
    var _namespace;

    if (typeof value === 'string') {
      value = stringToBytes(value);
    }

    if (typeof namespace === 'string') {
      namespace = (0,_parse_js__WEBPACK_IMPORTED_MODULE_1__["default"])(namespace);
    }

    if (((_namespace = namespace) === null || _namespace === void 0 ? void 0 : _namespace.length) !== 16) {
      throw TypeError('Namespace must be array-like (16 iterable integer values, 0-255)');
    } // Compute hash of namespace and value, Per 4.3
    // Future: Use spread syntax when supported on all platforms, e.g. `bytes =
    // hashfunc([...namespace, ... value])`


    let bytes = new Uint8Array(16 + value.length);
    bytes.set(namespace);
    bytes.set(value, namespace.length);
    bytes = hashfunc(bytes);
    bytes[6] = bytes[6] & 0x0f | version;
    bytes[8] = bytes[8] & 0x3f | 0x80;

    if (buf) {
      offset = offset || 0;

      for (let i = 0; i < 16; ++i) {
        buf[offset + i] = bytes[i];
      }

      return buf;
    }

    return (0,_stringify_js__WEBPACK_IMPORTED_MODULE_0__.unsafeStringify)(bytes);
  } // Function#name is not settable on some platforms (#270)


  try {
    generateUUID.name = name; // eslint-disable-next-line no-empty
  } catch (err) {} // For CommonJS default export support


  generateUUID.DNS = DNS;
  generateUUID.URL = URL;
  return generateUUID;
}

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/v4.js"
/*!***********************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/v4.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _native_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./native.js */ "./node_modules/uuid/dist/esm-node/native.js");
/* harmony import */ var _rng_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./rng.js */ "./node_modules/uuid/dist/esm-node/rng.js");
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-node/stringify.js");




function v4(options, buf, offset) {
  if (_native_js__WEBPACK_IMPORTED_MODULE_0__["default"].randomUUID && !buf && !options) {
    return _native_js__WEBPACK_IMPORTED_MODULE_0__["default"].randomUUID();
  }

  options = options || {};
  const rnds = options.random || (options.rng || _rng_js__WEBPACK_IMPORTED_MODULE_1__["default"])(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return (0,_stringify_js__WEBPACK_IMPORTED_MODULE_2__.unsafeStringify)(rnds);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v4);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/v5.js"
/*!***********************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/v5.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _v35_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./v35.js */ "./node_modules/uuid/dist/esm-node/v35.js");
/* harmony import */ var _sha1_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./sha1.js */ "./node_modules/uuid/dist/esm-node/sha1.js");


const v5 = (0,_v35_js__WEBPACK_IMPORTED_MODULE_0__["default"])('v5', 0x50, _sha1_js__WEBPACK_IMPORTED_MODULE_1__["default"]);
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v5);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/validate.js"
/*!*****************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/validate.js ***!
  \*****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _regex_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./regex.js */ "./node_modules/uuid/dist/esm-node/regex.js");


function validate(uuid) {
  return typeof uuid === 'string' && _regex_js__WEBPACK_IMPORTED_MODULE_0__["default"].test(uuid);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (validate);

/***/ },

/***/ "./node_modules/uuid/dist/esm-node/version.js"
/*!****************************************************!*\
  !*** ./node_modules/uuid/dist/esm-node/version.js ***!
  \****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-node/validate.js");


function version(uuid) {
  if (!(0,_validate_js__WEBPACK_IMPORTED_MODULE_0__["default"])(uuid)) {
    throw TypeError('Invalid UUID');
  }

  return parseInt(uuid.slice(14, 15), 16);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (version);

/***/ },

/***/ "crypto"
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
(module) {

"use strict";
module.exports = require("crypto");

/***/ },

/***/ "dgram"
/*!************************!*\
  !*** external "dgram" ***!
  \************************/
(module) {

"use strict";
module.exports = require("dgram");

/***/ },

/***/ "fs"
/*!*********************!*\
  !*** external "fs" ***!
  \*********************/
(module) {

"use strict";
module.exports = require("fs");

/***/ },

/***/ "http"
/*!***********************!*\
  !*** external "http" ***!
  \***********************/
(module) {

"use strict";
module.exports = require("http");

/***/ },

/***/ "module"
/*!*************************!*\
  !*** external "module" ***!
  \*************************/
(module) {

"use strict";
module.exports = require("module");

/***/ },

/***/ "os"
/*!*********************!*\
  !*** external "os" ***!
  \*********************/
(module) {

"use strict";
module.exports = require("os");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";
var exports = __webpack_exports__;
/*!*********************!*\
  !*** ./src/main.ts ***!
  \*********************/

Object.defineProperty(exports, "__esModule", ({ value: true }));
const sdk_1 = __webpack_require__(/*! @scrypted/sdk */ "./node_modules/@scrypted/sdk/dist/src/index.js");
const storage_settings_1 = __webpack_require__(/*! @scrypted/sdk/storage-settings */ "./node_modules/@scrypted/sdk/dist/src/storage-settings.js");
const cameraMixin_1 = __webpack_require__(/*! ./cameraMixin */ "./src/cameraMixin.ts");
const ipAlias_1 = __webpack_require__(/*! ./ipAlias */ "./src/ipAlias.ts");
class OnvifRebroadcastPlugin extends sdk_1.ScryptedDeviceBase {
    constructor(nativeId) {
        super(nativeId);
        this.currentMixinsMap = {};
        this.storageSettings = new storage_settings_1.StorageSettings(this, {
            username: {
                title: "Username",
                description: "Username for ONVIF authentication (leave empty to disable auth)",
                type: "string",
                group: "Authentication",
            },
            password: {
                title: "Password",
                description: "Password for ONVIF authentication",
                type: "password",
                group: "Authentication",
            },
            autoIpEnabled: {
                title: "Auto-assign unique IPs",
                description: "Automatically create a virtual IP alias for each camera so NVRs like UniFi can discover them as separate devices. Requires NET_ADMIN capability (Docker) or root (bare metal).",
                type: "boolean",
                defaultValue: false,
                group: "IP Allocation",
            },
            ipRangeStart: {
                title: "IP range start",
                description: 'First IP address to assign (e.g. "192.168.1.200"). Cameras get sequential IPs from here.',
                type: "string",
                placeholder: "192.168.1.200",
                group: "IP Allocation",
            },
            networkInterface: {
                title: "Network interface",
                description: 'Parent interface for the macvlan network (e.g. "br0"). This should be on the same LAN as your NVR. Leave empty for br0.',
                type: "string",
                placeholder: "br0",
                group: "IP Allocation",
            },
            subnetPrefix: {
                title: "Subnet prefix length",
                description: "CIDR prefix length for the macvlan network (e.g. 23 for /23 = 192.168.0.0-192.168.1.255)",
                type: "number",
                defaultValue: 23,
                group: "IP Allocation",
            },
            gateway: {
                title: "Gateway",
                description: "Default gateway for the macvlan network (e.g. 192.168.1.1)",
                type: "string",
                placeholder: "192.168.1.1",
                group: "IP Allocation",
            },
        });
        this.ipAliasManager = new ipAlias_1.IpAliasManager(this.console);
        this.console.log("ONVIF Rebroadcast plugin loaded");
    }
    /**
     * Get a persistent, stable IP index for a device.
     * Once assigned, a device always gets the same index (and thus the same IP).
     * Indices are stored in plugin storage and survive restarts.
     */
    getStableIpIndex(deviceId) {
        const storageKey = "ipIndexMap";
        let map = {};
        try {
            const raw = this.storage.getItem(storageKey);
            if (raw)
                map = JSON.parse(raw);
        }
        catch { }
        if (map[deviceId] !== undefined) {
            return map[deviceId];
        }
        // Assign next available index
        const usedIndices = new Set(Object.values(map));
        let next = 0;
        while (usedIndices.has(next))
            next++;
        map[deviceId] = next;
        this.storage.setItem(storageKey, JSON.stringify(map));
        this.console.log(`Assigned stable IP index ${next} to device ${deviceId}`);
        return next;
    }
    async getSettings() {
        return this.storageSettings.getSettings();
    }
    async putSetting(key, value) {
        await this.storageSettings.putSetting(key, value);
    }
    async canMixin(type, interfaces) {
        if ((type === sdk_1.ScryptedDeviceType.Camera ||
            type === sdk_1.ScryptedDeviceType.Doorbell) &&
            (interfaces.includes(sdk_1.ScryptedInterface.VideoCamera) ||
                interfaces.includes(sdk_1.ScryptedInterface.Camera))) {
            return [sdk_1.ScryptedInterface.Settings];
        }
        return undefined;
    }
    async getMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState) {
        const existing = this.currentMixinsMap[mixinDeviceState.id];
        if (existing) {
            this.console.log(`Releasing previous mixin for ${mixinDeviceState.name} before creating new one`);
            try {
                await existing.release();
            }
            catch (e) {
                this.console.warn(`Error releasing previous mixin: ${e.message}`);
            }
        }
        const mixin = new cameraMixin_1.OnvifRebroadcastCameraMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
            group: "ONVIF Rebroadcast",
            groupKey: "onvifRebroadcast",
        }, this);
        this.currentMixinsMap[mixinDeviceState.id] = mixin;
        return mixin;
    }
    async releaseMixin(id, mixinDevice) {
        delete this.currentMixinsMap[id];
        try {
            await mixinDevice.release();
        }
        catch (e) {
            // this.console.warn(`Error releasing mixin ${id}: ${(e as Error).message}`);
        }
    }
    /**
     * Called when the plugin is being shut down.
     * Cleans up all proxy containers to prevent orphaned containers.
     */
    async release() {
        this.console.log("Plugin shutting down — cleaning up proxy containers...");
        for (const [id, mixin] of Object.entries(this.currentMixinsMap)) {
            try {
                await mixin.release();
            }
            catch (e) {
                this.console.warn(`Error releasing mixin ${id}: ${e.message}`);
            }
        }
        this.currentMixinsMap = {};
        await this.ipAliasManager.removeAll();
    }
}
exports["default"] = OnvifRebroadcastPlugin;

})();

var __webpack_export_target__ = (exports = typeof exports === "undefined" ? {} : exports);
for(var __webpack_i__ in __webpack_exports__) __webpack_export_target__[__webpack_i__] = __webpack_exports__[__webpack_i__];
if(__webpack_exports__.__esModule) Object.defineProperty(__webpack_export_target__, "__esModule", { value: true });
/******/ })()
;

//# sourceURL=/plugin/main.nodejs.js
//# sourceMappingURL=main.nodejs.js.map