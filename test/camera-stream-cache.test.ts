import { describe, expect, it, vi } from "vitest";

const { configs } = vi.hoisted(() => ({ configs: [] as any[] }));
vi.mock("@scrypted/sdk", () => ({
  default: { systemManager: { getDeviceById: () => undefined }, mediaManager: {} },
  ScryptedInterface: {},
}));
vi.mock("@scrypted/sdk/settings-mixin", () => ({ SettingsMixinDeviceBase: class {} }));
vi.mock("@scrypted/sdk/storage-settings", () => ({ StorageSettings: class {} }));
vi.mock("../src/onvifServer", () => ({
  OnvifServer: class {
    constructor(_logger: unknown, config: unknown) { configs.push(config); }
    async start(port: number) { return port; }
  },
}));

import { OnvifRebroadcastCameraMixin } from "../src/cameraMixin";

function fixture(selectedStreams: string[] = []) {
  // Exercise the actual startup path without constructor timers, RPC, or sockets.
  const camera = Object.create(OnvifRebroadcastCameraMixin.prototype) as any;
  const streams = [
    { name: "Main", rtspUrl: "rtsp://192.0.2.10:40001/main?transport=tcp", width: 1920, height: 1080 },
    { name: "Sub", rtspUrl: "rtsp://192.0.2.10:40002/sub", width: 640, height: 360 },
    { name: "Extra", rtspUrl: "rtsp://192.0.2.10:40003/extra" },
  ];
  const addAlias = vi.fn(async () => ({ ok: true, proxyPort: 10000 }));
  Object.assign(camera, {
    id: "test-camera", name: "Test Camera", discoveredStreams: streams,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logger: { debug: vi.fn() },
    storageSettings: { values: { selectedStreams } },
    plugin: {
      storageSettings: { values: { autoIpEnabled: true, ipRangeStart: "192.0.2.100" } },
      getStableIpIndex: () => 0,
      ipAliasManager: { addAlias },
    },
    stopOnvifServer: vi.fn(), detectCapabilities: () => ({}), startEventListeners: vi.fn(),
  });
  return { camera, streams, addAlias };
}

describe("ONVIF stream URL isolation", () => {
  it.each([{ selection: [] }, { selection: ["Sub"] }, { selection: ["missing"] }])("keeps discovery URLs unchanged for $selection", async ({ selection }) => {
    const { camera, streams } = fixture(selection);
    const original = structuredClone(streams);
    await camera.startOnvifServer();
    expect(streams).toEqual(original);
    const published = configs.at(-1).streams;
    expect(published).toHaveLength(selection[0] === "Sub" ? 1 : 2);
    published.forEach((stream: any, index: number) => {
      expect(stream).not.toBe(streams.find(s => s.name === stream.name));
      const url = new URL(stream.rtspUrl);
      expect(url.hostname).toBe("192.0.2.100");
      expect(url.port).toBe(String(554 + index));
      const source = new URL(original.find(s => s.name === stream.name)!.rtspUrl);
      expect(url.pathname + url.search).toBe(source.pathname + source.search);
    });
  });

  it("reuses original backend targets after a restart and a profile selection change", async () => {
    const { camera, addAlias } = fixture();
    await camera.startOnvifServer();
    await camera.startOnvifServer();
    camera.storageSettings.values.selectedStreams = ["Sub"];
    await camera.startOnvifServer();
    expect(addAlias.mock.calls.map((args: any[]) => args[5])).toEqual([
      [{ host: "192.0.2.10", port: 40001 }, { host: "192.0.2.10", port: 40002 }],
      [{ host: "192.0.2.10", port: 40001 }, { host: "192.0.2.10", port: 40002 }],
      [{ host: "192.0.2.10", port: 40002 }],
    ]);
  });
});
