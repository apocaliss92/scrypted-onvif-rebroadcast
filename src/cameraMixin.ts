import sdk, {
  Camera,
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

const { systemManager, mediaManager } = sdk;

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

/**
 * Race a cross-boundary RPC call against a timeout so a camera that never
 * responds (e.g. cloud/WebRTC devices like Arlo whose RTSP is generated on
 * demand) cannot block mixin initialization forever. A hung await here would
 * otherwise leave the ONVIF server unstarted and let pending RPC results
 * accumulate until the plugin OOM-crashes.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const RPC_TIMEOUT_MS = 20000;

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
  private discoverInFlight: Promise<void> | null = null;
  private discoveredHasAudio = true;
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
    selectedStreams: {
      title: "Streams to expose via ONVIF",
      description:
        "Select up to 2 RTSP streams to publish as ONVIF profiles (main + substream). Synthetic streams created in the Rebroadcast plugin (e.g. with re-encoded audio for UniFi Protect) are listed here too. Leave empty to auto-pick the first two streams found.",
      type: "string",
      multiple: true,
      combobox: true,
      defaultValue: [],
      choices: [],
      onPut: async () => {
        if (this.storageSettings.values.serverEnabled) {
          await this.startOnvifServer();
        }
      },
    },
    refreshStreams: {
      title: "Refresh Streams",
      description: "Re-discover RTSP rebroadcast streams from the Rebroadcast plugin. Use this after adding a new synthetic stream.",
      type: "button",
      onPut: async () => {
        await this.discoverStreams();
        if (this.storageSettings.values.serverEnabled) {
          await this.startOnvifServer();
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

    try {
      await this.discoverStreams();

      if (this.killed) return;

      if (this.storageSettings.values.serverEnabled) {
        await this.startOnvifServer();
      }
    } catch (e) {
      this.console.error(
        `ONVIF Rebroadcast init failed for ${this.name}: ${(e as Error).message}`,
      );
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    // Update stream choices from the already-cached discoveredStreams without
    // re-running full RPC discovery on every settings access — discovery runs
    // at startup and on explicit refresh only to avoid heap accumulation from
    // repeated cross-boundary proxy allocations.
    this.updateStreamChoices();

    const settings = await this.storageSettings.getSettings();

    if (this.assignedPort && this.onvifServer?.isRunning) {
      const displayIp =
        (this.storageSettings.values.onvifIp as string) || getLocalIp();
      const baseUrl = `http://${displayIp}:${this.assignedPort}/onvif`;

      settings.push({
        key: "deviceServiceUrl",
        title: "ONVIF Device Service Url",
        description: `${baseUrl}/device_service`,
        value: `${baseUrl}/device_service`,
        type: "string",
        readonly: true,
        subgroup: "Service URLs",
      });

      settings.push({
        key: "mediaServiceUrl",
        title: "ONVIF Media Service Url",
        description: `${baseUrl}/media_service`,
        value: `${baseUrl}/media_service`,
        type: "string",
        readonly: true,
        subgroup: "Service URLs",
      });
    }

    return settings;
  }

  async putMixinSetting(key: string, value: SettingValue): Promise<void> {
    await this.storageSettings.putSetting(key, value);
  }

  /**
   * Discover RTSP rebroadcast streams from Scrypted for this camera.
   * Concurrent calls (startup init, settings refresh, server restart) are
   * de-duplicated onto a single in-flight run so we never fan out duplicate
   * cross-boundary RPC calls that could pile up as pending results.
   */
  private discoverStreams(): Promise<void> {
    if (this.discoverInFlight) return this.discoverInFlight;
    this.discoverInFlight = this._discoverStreams().finally(() => {
      this.discoverInFlight = null;
    });
    return this.discoverInFlight;
  }

  private async _discoverStreams() {
    this.discoveredStreams = [];

    try {
      const device = systemManager.getDeviceById(
        this.id,
      ) as unknown as Settings;
      if (!device?.getSettings) return;

      const deviceSettings = await withTimeout(
        device.getSettings(),
        RPC_TIMEOUT_MS,
        `${this.name} getSettings`,
      );
      const rtspSettings = deviceSettings.filter(
        (setting) => setting.title === "RTSP Rebroadcast Url",
      );

      // Also try to get video stream options for resolution info
      let streamOptions: any[] = [];
      try {
        const videoDevice = systemManager.getDeviceById(this.id) as any;
        if (videoDevice?.getVideoStreamOptions) {
          streamOptions = await withTimeout(
            videoDevice.getVideoStreamOptions(),
            RPC_TIMEOUT_MS,
            `${this.name} getVideoStreamOptions`,
          );
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

        // Try to find resolution from stream options (flexible matching since
        // rebroadcast subgroups use names like "RTMP main.bcs" while stream
        // options use "main.bcs" or similar)
        const matchedOption = streamOptions.find(
          (s) =>
            s.name === streamName ||
            streamName.includes(s.name) ||
            s.name?.includes(streamName) ||
            (s.id && streamName.includes(s.id)),
        );
        const width = matchedOption?.video?.width;
        const height = matchedOption?.video?.height;
        const videoCodec = matchedOption?.video?.codec;
        const audioCodec = matchedOption?.audio?.codec;
        const audioSampleRate = matchedOption?.audio?.sampleRate;
        const audioChannels = matchedOption?.audio?.channels;

        this.discoveredStreams.push({
          name: streamName,
          rtspUrl: resolvedUrl,
          width,
          height,
          videoCodec,
          audioCodec,
          audioSampleRate,
          audioChannels,
        });
      }

      // Detect audio: only treat as silent if every stream option explicitly
      // reports audio: null. Otherwise assume audio is present so the NVR records
      // it — advertising an audio track that turns out silent is harmless, whereas
      // never advertising audio means NVRs like UniFi Protect drop the track.
      this.discoveredHasAudio =
        streamOptions.length === 0 ||
        !streamOptions.every((s: any) => s?.audio === null);

      // Log stream option names for debugging resolution and codec matching
      if (streamOptions.length > 0) {
        this.console.log(
          `${this.name}: stream options: ${streamOptions
            .map(
              (s: any) =>
                `${s.name ?? s.id ?? "?"} [v=${s.video?.codec ?? "?"} ${s.video?.width ?? "?"}x${s.video?.height ?? "?"} / a=${s.audio?.codec ?? "?"} ${s.audio?.sampleRate ?? "?"}Hz ${s.audio?.channels ?? "?"}ch]`,
            )
            .join(", ")}`,
        );
      }

      this.updateStreamChoices();

      this.console.log(
        `${this.name}: found ${this.discoveredStreams.length} RTSP rebroadcast stream(s)`,
      );
      for (const s of this.discoveredStreams) {
        this.console.log(
          `  - ${s.name}: ${this.sanitizeUrl(s.rtspUrl)} | video=${s.videoCodec ?? "?"} ${s.width ?? "?"}x${s.height ?? "?"} | audio=${s.audioCodec ?? "?"} ${s.audioSampleRate ?? "?"}Hz ${s.audioChannels ?? "?"}ch`,
        );
        if (s.audioCodec && /pcm_?alaw|pcm_?mulaw|g711/i.test(s.audioCodec)) {
          this.console.warn(
            `  ⚠ Stream "${s.name}" uses ${s.audioCodec} audio — UniFi Protect may not record audio reliably. Create a synthetic stream in the Rebroadcast plugin with audio re-encoded to AAC and select it under "Streams to expose via ONVIF".`,
          );
        }
      }

      // If main stream still has no resolution, try probing via snapshot
      if (
        this.discoveredStreams.length > 0 &&
        !this.discoveredStreams[0].width
      ) {
        try {
          const cam = systemManager.getDeviceById(this.id) as unknown as Camera;
          if (cam?.takePicture) {
            const mediaObject = await withTimeout(
              cam.takePicture(),
              RPC_TIMEOUT_MS,
              `${this.name} takePicture`,
            );
            const buffer = await withTimeout(
              mediaManager.convertMediaObjectToBuffer(mediaObject, "image/jpeg"),
              RPC_TIMEOUT_MS,
              `${this.name} convertMediaObjectToBuffer`,
            );
            // Parse JPEG SOF0 marker for resolution
            const res = this.parseJpegResolution(buffer);
            if (res) {
              this.console.log(
                `${this.name}: detected resolution from snapshot: ${res.width}x${res.height}`,
              );
              // Apply to all streams that lack resolution (main gets full res, others assumed same)
              for (const s of this.discoveredStreams) {
                if (!s.width) {
                  s.width = res.width;
                  s.height = res.height;
                }
              }
            }
          }
        } catch (e) {
          this.console.warn(
            `${this.name}: snapshot resolution probe failed: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.console.warn(
        `Failed to discover streams for ${this.name}: ${(e as Error).message}`,
      );
    }
  }

  /** Push the discovered stream names into the selectedStreams choices dropdown. */
  private updateStreamChoices() {
    const choices = this.discoveredStreams.map((s) => s.name);
    const setting = this.storageSettings.settings.selectedStreams as
      | { choices?: string[] }
      | undefined;
    if (setting) {
      setting.choices = choices;
    }
  }

  /** Strip embedded credentials from URLs before logging */
  private sanitizeUrl(url: string): string {
    return url.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@");
  }

  /** Parse JPEG SOF0/SOF2 marker to extract width and height */
  private parseJpegResolution(
    buf: Buffer,
  ): { width: number; height: number } | null {
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
          if (width > 0 && height > 0) return { width, height };
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
      } else {
        break;
      }
    }
    return null;
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
      hasAudio: this.discoveredHasAudio,
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
      `${this.name} capabilities: PTZ=${capabilities.hasPtz}, Intercom=${capabilities.hasIntercom}, Audio=${capabilities.hasAudio}, Motion=${capabilities.hasMotionSensor}, AudioSensor=${capabilities.hasAudioSensor}, ObjectDetect=${capabilities.hasObjectDetection}`,
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

    // Apply user stream selection. ONVIF/UniFi Protect supports at most 2 profiles
    // (main + substream), so cap selection at 2. When nothing is selected, fall
    // back to the first 2 discovered streams to preserve existing behavior.
    const selected =
      (this.storageSettings.values.selectedStreams as string[] | undefined) ??
      [];
    let streamsToExpose: RtspStreamInfo[];
    if (selected.length > 0) {
      streamsToExpose = this.discoveredStreams.filter((s) =>
        selected.includes(s.name),
      );
      if (streamsToExpose.length === 0) {
        this.console.warn(
          `Selected streams [${selected.join(", ")}] not available for ${this.name}, falling back to first 2 streams.`,
        );
        streamsToExpose = this.discoveredStreams.slice(0, 2);
      } else {
        streamsToExpose = streamsToExpose.slice(0, 2);
      }
    } else {
      streamsToExpose = this.discoveredStreams.slice(0, 2);
    }

    // Log what we're about to expose. Since this plugin only wraps RTSP in ONVIF
    // (no transcoding), the output codecs are identical to the input — the log
    // makes that explicit so users can verify their synthetic-stream choice.
    this.console.log(
      `${this.name}: exposing ${streamsToExpose.length} ONVIF profile(s) (passthrough — input codec == output codec):`,
    );
    streamsToExpose.forEach((s, idx) => {
      const role = idx === 0 ? "MainStream" : "SubStream";
      this.console.log(
        `  [${role}] "${s.name}" → video: ${s.videoCodec ?? "?"} ${s.width ?? "?"}x${s.height ?? "?"} | audio: ${s.audioCodec ?? "?"} ${s.audioSampleRate ?? "?"}Hz ${s.audioChannels ?? "?"}ch`,
      );
    });

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
        const prefix =
          (this.plugin.storageSettings.values.subnetPrefix as number) || 23;
        const gateway =
          (this.plugin.storageSettings.values.gateway as string) || undefined;

        const cameraIndex = this.plugin.getStableIpIndex(this.id);
        const assignedIp = IpAliasManager.computeIp(
          baseIp,
          cameraIndex,
          prefix,
        );

        // Extract RTSP targets from exposed streams for proxying
        const rtspTargets = streamsToExpose
          .map((s) => {
            try {
              const url = new URL(s.rtspUrl);
              return { host: url.hostname, port: parseInt(url.port) || 554 };
            } catch {
              return null;
            }
          })
          .filter((t): t is { host: string; port: number } => t !== null);

        const shimIp =
          (this.plugin.storageSettings.values.macvlanShimIp as string) ||
          undefined;
        const result = await this.plugin.ipAliasManager.addAlias(
          this.id,
          assignedIp,
          iface,
          prefix,
          gateway,
          rtspTargets,
          shimIp,
        );
        if (result.ok && result.proxyPort) {
          onvifIp = assignedIp;
          proxyPort = result.proxyPort;

          // Rewrite RTSP URLs to go through the proxy container
          streamsToExpose.forEach((stream, idx) => {
            try {
              const url = new URL(stream.rtspUrl);
              url.hostname = assignedIp;
              url.port = String(554 + idx);
              stream.rtspUrl = url.toString();
              this.console.log(`Stream "${stream.name}" → ${stream.rtspUrl}`);
            } catch {}
          });

          this.console.log(
            `Auto-assigned IP ${assignedIp} to ${this.name} (proxy port ${proxyPort})`,
          );
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
    const port =
      proxyPort ||
      (onvifIp ? 8000 : (this.storageSettings.values.onvifPort as number) || 0);

    const username = this.plugin.storageSettings.values.username as string;
    const password = this.plugin.storageSettings.values.password as string;

    const capabilities = this.detectCapabilities();

    // Use actual device info from Scrypted
    const device = systemManager.getDeviceById(this.id);
    const deviceInfo = device?.info;

    const config: OnvifServiceConfig = {
      deviceName: device?.name || this.name || '',
      deviceId: this.id,
      manufacturer: deviceInfo?.manufacturer || "Unknown",
      model: deviceInfo?.model || "Unknown",
      firmwareVersion: deviceInfo?.firmware || deviceInfo?.version || "1.0.0",
      serialNumber: deviceInfo?.serialNumber || `scrypted-${this.id}`,
      hostname: localIp,
      onvifIp,
      proxyMode: !!proxyPort,
      onvifPort: port,
      streams: streamsToExpose,
      username: username || undefined,
      password: password || undefined,
      capabilities,
      getSnapshot: async () => {
        const cam = systemManager.getDeviceById(this.id) as unknown as Camera;
        if (!cam?.takePicture)
          throw new Error("Camera does not support snapshots");
        const mediaObject = await cam.takePicture();
        return mediaManager.convertMediaObjectToBuffer(
          mediaObject,
          "image/jpeg",
        );
      },
      ptzCommand: (command) => {
        try {
          const cam = systemManager.getDeviceById(this.id) as any;
          cam?.ptzCommand?.(command);
        } catch (e) {
          this.console.error("PTZ forward error", e);
        }
      },
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
