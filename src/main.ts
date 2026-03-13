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

export default class OnvifRebroadcastPlugin
  extends ScryptedDeviceBase
  implements Settings, MixinProvider
{
  currentMixinsMap: Record<string, OnvifRebroadcastCameraMixin> = {};

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
  });

  constructor(nativeId: string) {
    super(nativeId);
    this.console.log("ONVIF Rebroadcast plugin loaded");
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
      this.console.log(`Releasing previous mixin for ${mixinDeviceState.name} before creating new one`);
      try {
        await existing.release();
      } catch (e) {
        this.console.warn(`Error releasing previous mixin: ${(e as Error).message}`);
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
      this.console.warn(`Error releasing mixin ${id}: ${(e as Error).message}`);
    }
  }
}
