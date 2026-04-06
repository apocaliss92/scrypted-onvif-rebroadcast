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
import { IpAliasManager } from "./ipAlias";
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
  private assignedPort: number = 0;
  private killed = false;
  private motionListener: EventListenerRegister | null = null;
  private detectionListener: EventListenerRegister | null = null;

  storageSettings = new StorageSettings(this, {
    onvifIp: {
      title: "ONVIF IP address",
      description:
        "Unique IP address for this camera's ONVIF server (e.g. a virtual IP alias). Required for NVRs like UniFi that identify cameras by IP. Leave empty to use the host's default IP.",
      type: "string",
    },
    onvifPort: {
      title: "ONVIF port",
      description:
        "Port for this camera ONVIF server (defaults to 8000 when a custom IP is set, or auto-assigned otherwise)",
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
    const settings = await this.storageSettings.getSettings();

    if (this.assignedPort && this.onvifServer?.isRunning) {
      const displayIp = (this.storageSettings.values.onvifIp as string) || getLocalIp();
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

      this.logger.debug(
        `${this.name}: found ${this.discoveredStreams.length} RTSP rebroadcast stream(s)`,
      );
      for (const s of this.discoveredStreams) {
        this.logger.debug(
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

    this.logger.debug(`${this.name} interfaces: ${interfaces.join(", ")}`);

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

    this.logger.debug(
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
      this.logger.debug(
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

    const localIp = getLocalIp();
    let onvifIp = (this.storageSettings.values.onvifIp as string) || undefined;

    // Auto-assign IP from range if enabled and no manual IP is set
    let proxyPort: number | undefined;
    if (!onvifIp && this.plugin.storageSettings.values.autoIpEnabled) {
      const baseIp = this.plugin.storageSettings.values.ipRangeStart as string;
      if (baseIp) {
        const iface =
          (this.plugin.storageSettings.values.networkInterface as string) ||
          "br0";
        const prefix = (this.plugin.storageSettings.values.subnetPrefix as number) || 23;
        const gateway = (this.plugin.storageSettings.values.gateway as string) || undefined;

        const cameraIndex = this.plugin.getStableIpIndex(this.id);
        const assignedIp = IpAliasManager.computeIp(baseIp, cameraIndex, prefix);

        // Extract RTSP targets from discovered streams for proxying
        const rtspTargets = this.discoveredStreams
          .map((s) => {
            try {
              const url = new URL(s.rtspUrl);
              return { host: url.hostname, port: parseInt(url.port) || 554 };
            } catch { return null; }
          })
          .filter((t): t is { host: string; port: number } => t !== null);

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
            } catch {}
          });

          this.console.log(`Auto-assigned IP ${assignedIp} to ${this.name} (proxy port ${proxyPort})`);
        } else {
          this.console.warn(
            `Failed to auto-assign IP ${assignedIp} for ${this.name}. Falling back to shared IP.`,
          );
        }
      } else {
        this.console.warn(
          `Auto-assign IPs is enabled but no IP range start is configured.`,
        );
      }
    }

    // When using proxy containers, the ONVIF server listens on the proxy port
    // on the container's main IP, and the proxy container forwards port 8000 to it.
    // When not using proxies, use port 8000 if we have a unique IP, otherwise auto-assign.
    const port = proxyPort || (onvifIp ? 8000 : ((this.storageSettings.values.onvifPort as number) || 0));

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
      onvifIp,
      proxyMode: !!proxyPort,
      onvifPort: port,
      streams: this.discoveredStreams,
      username: username || undefined,
      password: password || undefined,
      capabilities,
    };

    this.onvifServer = new OnvifServer(this.console, config);

    try {
      this.assignedPort = await this.onvifServer.start(port);

      // Save the assigned port to settings so it persists across restarts
      if (this.assignedPort !== port) {
        await this.storageSettings.putSetting("onvifPort", this.assignedPort);
        this.console.log(
          `Saved assigned port ${this.assignedPort} to settings for ${this.name}`,
        );
      }

      const displayIp = onvifIp || localIp;
      this.console.log(
        `ONVIF device "${this.name}" available at http://${displayIp}:${proxyPort ? 8000 : this.assignedPort}/onvif/device_service`,
      );
      this.logger.debug(`Camera is now discoverable via ONVIF WS-Discovery`);

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
      this.logger.debug(`Motion event listener started for ${this.name}`);
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
      this.logger.debug(
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
    // Clean up auto-assigned IP alias
    await this.plugin.ipAliasManager.removeAlias(this.id);
  }

  async release() {
    if (this.killed) return;
    this.killed = true;
    this.console.log(`Releasing ONVIF mixin for ${this.name}`);
    await this.stopOnvifServer();
    super.release();
  }
}
