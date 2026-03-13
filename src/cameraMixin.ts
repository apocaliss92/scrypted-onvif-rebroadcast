import sdk, {
  EventListenerRegister,
  ObjectsDetected,
  Setting,
  SettingValue,
  ScryptedInterface,
  Settings,
} from "@scrypted/sdk";
import {
  SettingsMixinDeviceBase,
  SettingsMixinDeviceOptions,
} from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { OnvifServer } from "./onvifServer";
import {
  RtspStreamInfo,
  OnvifServiceConfig,
  DeviceCapabilities,
  OnvifEvent,
} from "./types";
import os from "os";

import type OnvifRebroadcastPlugin from "./main";

const { systemManager } = sdk;

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

export class OnvifRebroadcastCameraMixin extends SettingsMixinDeviceBase<any> {
  private plugin: OnvifRebroadcastPlugin;
  private logger: {
    log: (...args: any[]) => void;
    debug: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  private onvifServer: OnvifServer | null = null;
  private discoveredStreams: RtspStreamInfo[] = [];
  private killed = false;
  private motionListener: EventListenerRegister | null = null;
  private detectionListener: EventListenerRegister | null = null;

  storageSettings = new StorageSettings(this, {
    onvifPort: {
      title: "ONVIF port",
      description:
        "Port for this camera ONVIF server (leave empty for auto, each camera needs a unique port)",
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
        } else {
          await this.stopOnvifServer();
        }
      },
    },
    debugEvents: {
      title: "Debug events",
      description:
        "Enable verbose logging for events (motion, object detection)",
      type: "boolean",
      defaultValue: false,
      immediate: true,
    },
    refreshStreams: {
      title: "Refresh streams",
      type: "button",
      onPut: async () => {
        await this.discoverStreams();
        if (this.onvifServer?.isRunning) {
          this.onvifServer.updateStreams(this.discoveredStreams);
          this.console.log(`Streams updated for ${this.name}`);
        }
      },
    },
  });

  constructor(
    options: SettingsMixinDeviceOptions<any>,
    plugin: OnvifRebroadcastPlugin,
  ) {
    super(options);
    this.plugin = plugin;
    this.logger = {
      log: (message: string, ...args: any[]) =>
        this.console.log(message, ...args),
      debug: (message: string, ...args: any[]) => {
        if (this.storageSettings.values.debugEvents)
          this.console.log(`[DEBUG] ${message}`, ...args);
      },
      warn: (message: string, ...args: any[]) =>
        this.console.warn(message, ...args),
      error: (message: string, ...args: any[]) =>
        this.console.error(message, ...args),
    };

    setTimeout(() => this.init(), 5000);
  }

  private async init() {
    if (this.killed) return;

    this.console.log(`ONVIF Rebroadcast mixin initialized for ${this.name}`);

    await this.discoverStreams();

    if (this.killed) return;

    if (this.storageSettings.values.serverEnabled) {
      await this.startOnvifServer();
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }

  async putMixinSetting(key: string, value: SettingValue): Promise<void> {
    await this.storageSettings.putSetting(key, value);
  }

  /**
   * Discover RTSP rebroadcast streams from Scrypted for this camera.
   */
  private async discoverStreams() {
    this.discoveredStreams = [];

    try {
      const device = systemManager.getDeviceById(
        this.id,
      ) as unknown as Settings;
      if (!device?.getSettings) return;

      const deviceSettings = await device.getSettings();
      const rtspSettings = deviceSettings.filter(
        (setting) => setting.title === "RTSP Rebroadcast Url",
      );

      // Also try to get video stream options for resolution info
      let streamOptions: any[] = [];
      try {
        const videoDevice = systemManager.getDeviceById(this.id) as any;
        if (videoDevice?.getVideoStreamOptions) {
          streamOptions = await videoDevice.getVideoStreamOptions();
        }
      } catch {
        /* ignore */
      }

      for (const setting of rtspSettings) {
        const rtspUrl = setting.value as string;
        if (!rtspUrl) continue;

        const streamName =
          setting.subgroup?.replace("Stream: ", "") ?? "Default";

        // Replace localhost with actual IP so external clients can reach it
        const localIp = getLocalIp();
        const resolvedUrl = rtspUrl.replace("localhost", localIp);

        // Try to find resolution from stream options
        const matchedOption = streamOptions.find((s) => s.name === streamName);
        const width = matchedOption?.video?.width;
        const height = matchedOption?.video?.height;

        this.discoveredStreams.push({
          name: streamName,
          rtspUrl: resolvedUrl,
          width,
          height,
        });
      }

      this.console.log(
        `${this.name}: found ${this.discoveredStreams.length} RTSP rebroadcast stream(s)`,
      );
      for (const s of this.discoveredStreams) {
        this.console.log(
          `  - ${s.name}: ${s.rtspUrl} (${s.width ?? "?"}x${s.height ?? "?"})`,
        );
      }
    } catch (e) {
      this.console.warn(
        `Failed to discover streams for ${this.name}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Detect which Scrypted interfaces this device supports and map to ONVIF capabilities.
   */
  private detectCapabilities(): DeviceCapabilities {
    const device = systemManager.getDeviceById(this.id);
    const interfaces = device?.interfaces ?? this.mixinDeviceInterfaces;
    const has = (iface: ScryptedInterface) => interfaces.includes(iface);

    this.console.log(`${this.name} interfaces: ${interfaces.join(", ")}`);

    const capabilities: DeviceCapabilities = {
      hasPtz: has(ScryptedInterface.PanTiltZoom),
      hasIntercom: has(ScryptedInterface.Intercom),
      hasMotionSensor: has(ScryptedInterface.MotionSensor),
      hasAudioSensor: has(ScryptedInterface.AudioSensor),
      hasObjectDetection: has(ScryptedInterface.ObjectDetector),
    };

    // Get PTZ sub-capabilities
    if (capabilities.hasPtz) {
      try {
        const device = systemManager.getDeviceById(this.id) as any;
        const ptzCaps = device?.ptzCapabilities;
        if (ptzCaps) {
          capabilities.ptzCapabilities = {
            pan: ptzCaps.pan,
            tilt: ptzCaps.tilt,
            zoom: ptzCaps.zoom,
          };
        }
      } catch {
        /* ignore */
      }
    }

    this.console.log(
      `${this.name} capabilities: PTZ=${capabilities.hasPtz}, Intercom=${capabilities.hasIntercom}, Motion=${capabilities.hasMotionSensor}, Audio=${capabilities.hasAudioSensor}, ObjectDetect=${capabilities.hasObjectDetection}`,
    );

    return capabilities;
  }

  /**
   * Start the ONVIF server for this camera.
   * This makes the camera discoverable via ONVIF WS-Discovery and
   * serves GetProfiles/GetStreamUri with the Scrypted rebroadcast RTSP URLs.
   */
  private async startOnvifServer() {
    await this.stopOnvifServer();

    if (this.discoveredStreams.length === 0) {
      this.console.log(
        `No streams discovered for ${this.name}, trying to discover...`,
      );
      await this.discoverStreams();
    }

    if (this.discoveredStreams.length === 0) {
      this.console.warn(
        `No RTSP rebroadcast streams found for ${this.name}. Make sure the Rebroadcast plugin is installed.`,
      );
      return;
    }

    const port = (this.storageSettings.values.onvifPort as number) || 0;
    const localIp = getLocalIp();

    const username = this.plugin.storageSettings.values.username as string;
    const password = this.plugin.storageSettings.values.password as string;

    const capabilities = this.detectCapabilities();

    // Use actual device info from Scrypted
    const device = systemManager.getDeviceById(this.id);
    const deviceInfo = device?.info;

    const config: OnvifServiceConfig = {
      deviceName: device?.name || this.name,
      deviceId: this.id,
      manufacturer: deviceInfo?.manufacturer || "Unknown",
      model: deviceInfo?.model || "Unknown",
      firmwareVersion: deviceInfo?.firmware || deviceInfo?.version || "1.0.0",
      serialNumber: deviceInfo?.serialNumber || `scrypted-${this.id}`,
      hostname: localIp,
      onvifPort: port,
      streams: this.discoveredStreams,
      username: username || undefined,
      password: password || undefined,
      capabilities,
    };

    this.onvifServer = new OnvifServer(this.console, config);

    try {
      const assignedPort = await this.onvifServer.start(port);

      // Save the assigned port to settings so it persists across restarts
      if (assignedPort !== port) {
        await this.storageSettings.putSetting("onvifPort", assignedPort);
        this.console.log(
          `Saved assigned port ${assignedPort} to settings for ${this.name}`,
        );
      }

      this.console.log(
        `ONVIF device "${this.name}" available at http://${localIp}:${assignedPort}/onvif/device_service`,
      );
      this.console.log(`Camera is now discoverable via ONVIF WS-Discovery`);

      this.startEventListeners(capabilities);
    } catch (e) {
      this.console.error(
        `Failed to start ONVIF server for ${this.name}`,
        (e as Error).message,
      );
    }
  }

  /**
   * Start listening to Scrypted device events and forward them to the ONVIF event queue.
   */
  private startEventListeners(capabilities: DeviceCapabilities) {
    this.stopEventListeners();

    if (capabilities.hasMotionSensor) {
      this.motionListener = systemManager.listenDevice(
        this.id,
        { event: ScryptedInterface.MotionSensor },
        (_source, _eventDetails, data) => {
          const motionActive = !!data;
          this.logger.debug(`${this.name} motion: ${motionActive}`);
          this.onvifServer?.pushEvent({
            topic: "tns1:VideoSource/MotionAlarm",
            timestamp: new Date(),
            source: `video_src_0`,
            data: { State: motionActive },
          });
        },
      );
      this.console.log(`Motion event listener started for ${this.name}`);
    }

    if (capabilities.hasObjectDetection) {
      this.detectionListener = systemManager.listenDevice(
        this.id,
        { event: ScryptedInterface.ObjectDetector },
        (_source, _eventDetails, data) => {
          const detected: ObjectsDetected = data;
          if (!detected?.detections?.length) return;

          for (const detection of detected.detections) {
            this.logger.debug(
              `${this.name} detection: ${detection.className} (${((detection.score ?? 0) * 100).toFixed(0)}%)`,
            );
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
        },
      );
      this.console.log(
        `Object detection event listener started for ${this.name}`,
      );
    }
  }

  private stopEventListeners() {
    this.motionListener?.removeListener();
    this.motionListener = null;
    this.detectionListener?.removeListener();
    this.detectionListener = null;
  }

  private async stopOnvifServer() {
    this.stopEventListeners();
    if (this.onvifServer) {
      await this.onvifServer.stop();
      this.onvifServer = null;
    }
  }

  async release() {
    if (this.killed) return;
    this.killed = true;
    this.console.log(`Releasing ONVIF mixin for ${this.name}`);
    await this.stopOnvifServer();
    super.release();
  }
}
