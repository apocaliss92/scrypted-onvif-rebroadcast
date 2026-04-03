import sdk, {
  MixinProvider,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  Setting,
  Settings,
  SettingValue,
  WritableDeviceState,
} from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { OnvifRebroadcastCameraMixin } from "./cameraMixin";
import { IpAliasManager } from "./ipAlias";

export default class OnvifRebroadcastPlugin
  extends ScryptedDeviceBase
  implements Settings, MixinProvider
{
  currentMixinsMap: Record<string, OnvifRebroadcastCameraMixin> = {};
  ipAliasManager: IpAliasManager;

  storageSettings = new StorageSettings(this, {
    username: {
      title: "Username",
      description:
        "Username for ONVIF authentication (leave empty to disable auth)",
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
      description:
        "Automatically create a virtual IP alias for each camera so NVRs like UniFi can discover them as separate devices. Requires NET_ADMIN capability (Docker) or root (bare metal).",
      type: "boolean",
      defaultValue: false,
      group: "IP Allocation",
    },
    ipRangeStart: {
      title: "IP range start",
      description:
        'First IP address to assign (e.g. "192.168.1.200"). Cameras get sequential IPs from here.',
      type: "string",
      placeholder: "192.168.1.200",
      group: "IP Allocation",
    },
    networkInterface: {
      title: "Network interface",
      description:
        'Parent interface for the macvlan network (e.g. "br0"). This should be on the same LAN as your NVR. Leave empty for br0.',
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

  constructor(nativeId: string) {
    super(nativeId);
    this.ipAliasManager = new IpAliasManager(this.console);
    this.console.log("ONVIF Rebroadcast plugin loaded");
  }

  /**
   * Get a persistent, stable IP index for a device.
   * Once assigned, a device always gets the same index (and thus the same IP).
   * Indices are stored in plugin storage and survive restarts.
   */
  getStableIpIndex(deviceId: string): number {
    const storageKey = "ipIndexMap";
    let map: Record<string, number> = {};
    try {
      const raw = this.storage.getItem(storageKey);
      if (raw) map = JSON.parse(raw);
    } catch {}

    if (map[deviceId] !== undefined) {
      return map[deviceId];
    }

    // Assign next available index
    const usedIndices = new Set(Object.values(map));
    let next = 0;
    while (usedIndices.has(next)) next++;
    map[deviceId] = next;
    this.storage.setItem(storageKey, JSON.stringify(map));
    this.console.log(`Assigned stable IP index ${next} to device ${deviceId}`);
    return next;
  }

  async getSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    await this.storageSettings.putSetting(key, value);
  }

  async canMixin(
    type: ScryptedDeviceType,
    interfaces: string[],
  ): Promise<string[]> {
    if (
      (type === ScryptedDeviceType.Camera ||
        type === ScryptedDeviceType.Doorbell) &&
      (interfaces.includes(ScryptedInterface.VideoCamera) ||
        interfaces.includes(ScryptedInterface.Camera))
    ) {
      return [ScryptedInterface.Settings];
    }
    return undefined;
  }

  async getMixin(
    mixinDevice: any,
    mixinDeviceInterfaces: ScryptedInterface[],
    mixinDeviceState: WritableDeviceState,
  ): Promise<any> {
    const existing = this.currentMixinsMap[mixinDeviceState.id];
    if (existing) {
      this.console.log(
        `Releasing previous mixin for ${mixinDeviceState.name} before creating new one`,
      );
      try {
        await existing.release();
      } catch (e) {
        this.console.warn(
          `Error releasing previous mixin: ${(e as Error).message}`,
        );
      }
    }

    const mixin = new OnvifRebroadcastCameraMixin(
      {
        mixinDevice,
        mixinDeviceInterfaces,
        mixinDeviceState,
        mixinProviderNativeId: this.nativeId,
        group: "ONVIF Rebroadcast",
        groupKey: "onvifRebroadcast",
      },
      this,
    );

    this.currentMixinsMap[mixinDeviceState.id] = mixin;
    return mixin;
  }

  async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    delete this.currentMixinsMap[id];
    try {
      await mixinDevice.release();
    } catch (e) {
      // this.console.warn(`Error releasing mixin ${id}: ${(e as Error).message}`);
    }
  }
}
