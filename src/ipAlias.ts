import http from "http";
import os from "os";
import crypto from "crypto";
import fs from "fs";

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API_TIMEOUT_MS = 30000;

interface DockerNetwork {
  Id: string;
  Name: string;
  Driver: string;
}

interface DockerImage {
  RepoTags?: string[];
}

interface DockerContainerState {
  Running: boolean;
  ExitCode: number;
}

interface DockerContainerNetworkSettings {
  IPAddress?: string;
  MacAddress?: string;
}

interface DockerContainerInfo {
  Id?: string;
  State?: DockerContainerState;
  NetworkSettings?: {
    Networks?: Record<string, DockerContainerNetworkSettings>;
  };
}

interface DockerCreateResponse {
  Id?: string;
  id?: string;
  message?: string;
}

interface DockerNetworkDetail {
  Name: string;
  Driver: string;
  Options?: Record<string, string>;
  IPAM?: {
    Config?: Array<{ Subnet?: string; Gateway?: string }>;
  };
}

export class IpAliasManager {
  private console: Console;
  private activeProxies: Map<string, { ip: string; mac: string; containerId: string; proxyPort: number }> = new Map();
  private dockerAvailable: boolean | null = null;
  private networkCreated = false;
  private nextProxyPort = 18000;
  private initLock: Promise<void> | null = null;

  constructor(console: Console) {
    this.console = console;
  }

  static generateMac(deviceId: string): string {
    const hash = crypto.createHash("md5").update(`onvif-mac-${deviceId}`).digest();
    const bytes = [0x02, hash[0], hash[1], hash[2], hash[3], hash[4]];
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
  }

  static computeIp(baseIp: string, index: number, prefixLength?: number): string {
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
        throw new Error(
          `Computed IP ${parts.join(".")} (index ${index}) is outside the /${prefixLength} subnet of ${baseIp}`
        );
      }
    }

    return parts.join(".");
  }

  /**
   * Sanitize a string for use as a Docker container name.
   * Docker allows [a-zA-Z0-9_.-] only.
   */
  private static sanitizeContainerName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  }

  private hasDockerSocket(): boolean {
    if (this.dockerAvailable !== null) return this.dockerAvailable;
    this.dockerAvailable = fs.existsSync(DOCKER_SOCKET);
    if (this.dockerAvailable) {
      this.console.log("Docker socket found — proxy container mode available");
    }
    return this.dockerAvailable;
  }

  /**
   * Get the container's main IP (for proxying traffic to).
   */
  getContainerIp(): string {
    const interfaces = os.networkInterfaces();
    for (const [, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal) return addr.address;
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
  private async findBridgeConnection(): Promise<{ network: string; ip: string } | null> {
    try {
      // Collect all our own IPs so we can identify which container is "us"
      const myIps = new Set<string>();
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const addr of addrs ?? []) {
          if (addr.family === "IPv4") myIps.add(addr.address);
        }
      }

      interface NetworkSummary { Id: string; Name: string; Driver: string; }
      interface NetworkDetail {
        Name: string;
        Containers?: Record<string, { IPv4Address: string }>;
      }

      const networks = await this.dockerApiGet<NetworkSummary[]>("/networks");
      for (const net of networks ?? []) {
        if (net.Driver !== "bridge") continue;
        const detail = await this.dockerApiGet<NetworkDetail>(`/networks/${net.Id}`);
        for (const container of Object.values(detail?.Containers ?? {})) {
          const ip = (container as { IPv4Address: string }).IPv4Address?.split("/")[0];
          if (ip && myIps.has(ip)) {
            return { network: net.Name, ip };
          }
        }
      }
    } catch (e: unknown) {
      this.console.debug?.(`Bridge network detection failed: ${(e as Error).message}`);
    }
    return null;
  }

  /**
   * Allocate a unique port for the ONVIF server to listen on internally.
   * This port is proxied through the macvlan proxy container.
   */
  allocateProxyPort(): number {
    return this.nextProxyPort++;
  }

  private macvlanNetworkName: string | null = null;
  private networkOwnedByUs = false;
  private static readonly NETWORK_NAME = "onvif_cameras";

  /** Returns true if `ip` falls within `subnet` (e.g. "192.168.1.0/24"). */
  private static ipInSubnet(ip: string, subnet: string): boolean {
    const [netStr, prefixStr] = subnet.split("/");
    const prefix = parseInt(prefixStr, 10);
    if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
    const toNum = (s: string) => {
      const p = s.split(".").map(Number);
      if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
      return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
    };
    const ipNum = toNum(ip);
    const netNum = toNum(netStr);
    if (ipNum === null || netNum === null) return false;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (netNum & mask);
  }

  /**
   * Serialize access to shared Docker initialization (network + image).
   * Prevents race conditions when multiple cameras initialize simultaneously.
   */
  private async withInitLock<T>(fn: () => Promise<T>): Promise<T> {
    while (this.initLock) {
      await this.initLock;
    }
    let resolve: () => void;
    this.initLock = new Promise<void>((r) => (resolve = r));
    try {
      return await fn();
    } finally {
      this.initLock = null;
      resolve!();
    }
  }

  /**
   * Create a dedicated macvlan Docker network on br0 for ONVIF proxy containers.
   * This is separate from the Scrypted container's ipvlan network (br0.2),
   * giving each proxy container a unique MAC address.
   */
  private async ensureMacvlanNetwork(
    parentIface: string,
    subnet: string,
    gateway: string,
    ip: string,
  ): Promise<boolean> {
    if (this.macvlanNetworkName) return true;

    const networks = (await this.dockerApiGet<DockerNetwork[]>("/networks")) || [];
    const netSummary = networks.map((n) => `${n.Name}(${n.Driver})`).join(", ");
    this.console.log(`Available Docker networks: ${netSummary}`);

    // 1. Exact-name match — our own network from a prior run
    const byName = networks.find((n) => n.Name === IpAliasManager.NETWORK_NAME);
    if (byName) {
      this.macvlanNetworkName = IpAliasManager.NETWORK_NAME;
      this.networkOwnedByUs = true;
      this.console.log(`Using existing ${IpAliasManager.NETWORK_NAME} network (${byName.Driver})`);
      return true;
    }

    // 2. Match by config — any macvlan on the same parent whose subnet contains our IP.
    // Docker only allows one macvlan per parent interface, so a foreign network on
    // our parent would block creation anyway. Reuse it when our IP fits.
    for (const net of networks) {
      if (net.Driver !== "macvlan") continue;
      let detail: DockerNetworkDetail | null = null;
      try {
        detail = await this.dockerApiGet<DockerNetworkDetail>(`/networks/${net.Id}`);
      } catch {
        continue;
      }
      if (detail?.Options?.parent !== parentIface) continue;

      const existingSubnet = detail?.IPAM?.Config?.[0]?.Subnet;
      if (!existingSubnet) continue;

      if (IpAliasManager.ipInSubnet(ip, existingSubnet)) {
        this.macvlanNetworkName = net.Name;
        this.networkOwnedByUs = false;
        this.console.log(
          `Reusing existing macvlan '${net.Name}' on ${parentIface} (${existingSubnet}) — IP ${ip} fits`,
        );
        return true;
      }

      this.console.error(
        `Macvlan '${net.Name}' already claims parent ${parentIface} with subnet ${existingSubnet}, ` +
        `but assigned IP ${ip} is outside it. Either change the plugin's IP range to fall within ` +
        `${existingSubnet}, or remove '${net.Name}' (docker network rm ${net.Name}) so this plugin ` +
        `can create its own.`,
      );
      return false;
    }

    // 3. Create our own
    this.console.log(`Creating macvlan network '${IpAliasManager.NETWORK_NAME}' on ${parentIface} (${subnet})...`);
    const result = await this.dockerApiPost<DockerCreateResponse>("/networks/create", {
      Name: IpAliasManager.NETWORK_NAME,
      Driver: "macvlan",
      Options: { parent: parentIface },
      IPAM: {
        Config: [{ Subnet: subnet, Gateway: gateway }],
      },
    });

    if (result?.Id || result?.id) {
      this.macvlanNetworkName = IpAliasManager.NETWORK_NAME;
      this.networkOwnedByUs = true;
      this.console.log(`Created macvlan network on ${parentIface} (${subnet})`);
      return true;
    }

    // Race condition: another camera created it between our list and create
    if (result?.message?.includes("already exists")) {
      this.macvlanNetworkName = IpAliasManager.NETWORK_NAME;
      this.networkOwnedByUs = true;
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
  async addAlias(
    deviceId: string,
    ip: string,
    parentIface: string,
    prefix: number,
    gatewayOverride?: string,
    rtspTargets?: { port: number; host: string }[],
  ): Promise<{ ok: boolean; proxyPort?: number }> {
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
        const info = await this.dockerApiGet<DockerContainerInfo>(`/containers/${containerName}/json`);
        if (info?.State?.Running) {
          return { ok: true, proxyPort: existing.proxyPort };
        }
      } catch (e: unknown) {
        this.console.debug?.(`Could not inspect existing container ${containerName}: ${(e as Error).message}`);
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
      const netOk = await this.ensureMacvlanNetwork(parentIface, subnet, gateway, ip);
      if (!netOk) return false;

      // Ensure socat image is available
      await this.ensureSocatImage();
      return true;
    });

    if (!initOk) return { ok: false };

    // Allocate a unique internal port for the ONVIF server
    const proxyPort = this.allocateProxyPort();

    // Prefer a Docker bridge IP over the physical host IP.
    // macvlan containers cannot reach the Docker host via its physical IP due to
    // Linux macvlan isolation — socat would connect to the host and get EHOSTUNREACH.
    // Connecting the proxy to the same bridge network as Scrypted bypasses this.
    const bridge = await this.findBridgeConnection();
    const scryptedIp = bridge?.ip ?? this.getContainerIp();
    if (!bridge) {
      this.console.warn(
        "Scrypted does not appear to be on a Docker bridge network. " +
        "Falling back to host IP for socat forwarding — if ONVIF adoption fails, " +
        "a macvlan shim interface on the host may be required."
      );
    }

    // Remove existing proxy container if any
    await this.removeProxyContainer(containerName);

    // Build socat command: always proxy ONVIF (8000), optionally proxy RTSP (554+)
    let cmd: string[];
    let entrypoint: string[] | undefined;
    if (rtspTargets && rtspTargets.length > 0) {
      // Run multiple socat instances: ONVIF + one per RTSP stream
      // Validate hostnames/ports to prevent shell injection
      const sanitizeHost = (h: string) => {
        if (!/^[a-zA-Z0-9._-]+$/.test(h)) throw new Error(`Invalid hostname: ${h}`);
        return h;
      };
      const sanitizePort = (p: number) => {
        if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Invalid port: ${p}`);
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
    } else {
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
        NetworkMode: this.macvlanNetworkName!,
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [this.macvlanNetworkName!]: {
            IPAMConfig: { IPv4Address: ip },
          },
        },
      },
    };

    const createResult = await this.dockerApiPost<DockerCreateResponse>(
      `/containers/create?name=${containerName}`,
      containerConfig,
    );

    if (!createResult?.Id) {
      this.console.error(`Failed to create proxy container for ${ip}: ${JSON.stringify(createResult)}`);
      return { ok: false };
    }

    // Start the container
    const startResult = await this.dockerApiPost<DockerCreateResponse>(`/containers/${createResult.Id}/start`, {});
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
      } catch (e: unknown) {
        this.console.warn(`Could not connect proxy to bridge network '${bridge.network}': ${(e as Error).message}`);
      }
    }

    // Wait a moment then verify it's running
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const info = await this.dockerApiGet<DockerContainerInfo>(`/containers/${containerName}/json`);
      if (info?.State?.Running) {
        const actualIp = info?.NetworkSettings?.Networks?.[this.macvlanNetworkName!]?.IPAddress || ip;
        const actualMac = info?.NetworkSettings?.Networks?.[this.macvlanNetworkName!]?.MacAddress || mac;
        this.activeProxies.set(deviceId, { ip: actualIp, mac: actualMac, containerId: createResult.Id, proxyPort });
        this.console.log(
          `Proxy container ${containerName}: IP=${actualIp} MAC=${actualMac} → ${scryptedIp}:${proxyPort}`,
        );
        return { ok: true, proxyPort };
      }
      const exitCode = info?.State?.ExitCode;
      this.console.error(`Proxy container exited with code ${exitCode}. State: ${JSON.stringify(info?.State)}`);
    } catch (e: unknown) {
      this.console.error(`Failed to inspect proxy container: ${(e as Error).message}`);
    }

    await this.removeProxyContainer(containerName);
    return { ok: false };
  }

  /**
   * Ensure the socat image is available locally.
   */
  private async ensureSocatImage(): Promise<void> {
    // Check if image exists
    try {
      const images = await this.dockerApiGet<DockerImage[]>("/images/json");
      const hasImage = images?.some?.((img) =>
        img.RepoTags?.some?.((t) => t.includes("socat"))
      );
      if (hasImage) return;
    } catch (e: unknown) {
      this.console.debug?.(`Could not check Docker images: ${(e as Error).message}`);
    }

    // Pull the image (streaming response — need to consume the full stream)
    this.console.log("Pulling alpine/socat image (requires internet access)...");
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: DOCKER_SOCKET,
          path: "/images/create?fromImage=alpine%2Fsocat&tag=latest",
          method: "POST",
        },
        (res) => {
          res.on("data", () => {}); // consume stream
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              this.console.error(
                `Failed to pull alpine/socat (HTTP ${res.statusCode}). ` +
                `In air-gapped environments, pre-pull the image: docker pull alpine/socat`
              );
            } else {
              this.console.log("Image pull complete");
            }
            resolve();
          });
        },
      );
      req.on("error", (e) => {
        this.console.error(
          `Failed to pull alpine/socat: ${e.message}. ` +
          `In air-gapped environments, pre-pull the image: docker pull alpine/socat`
        );
        reject(e);
      });
      req.setTimeout(120000, () => reject(new Error("Image pull timeout")));
      req.end();
    });
  }

  /**
   * Remove a proxy container. Waits for stop to complete before deleting.
   */
  private async removeProxyContainer(name: string): Promise<void> {
    // Stop the container first and wait for it to complete
    try {
      await this.dockerApiPost(`/containers/${name}/stop?t=5`, {});
    } catch {
      // Container may not exist or already stopped
    }

    // Now delete it
    await new Promise<void>((resolve) => {
      const req = http.request(
        { socketPath: DOCKER_SOCKET, path: `/containers/${name}?force=true`, method: "DELETE" },
        (res) => { res.resume(); res.on("end", () => resolve()); },
      );
      req.on("error", () => resolve());
      req.setTimeout(DOCKER_API_TIMEOUT_MS, () => resolve());
      req.end();
    });
  }

  /**
   * Remove a proxy for a camera.
   */
  async removeAlias(deviceId: string): Promise<void> {
    const proxy = this.activeProxies.get(deviceId);
    if (!proxy) return;
    const containerName = IpAliasManager.sanitizeContainerName(`onvif-proxy-${deviceId}`);
    await this.removeProxyContainer(containerName);
    this.activeProxies.delete(deviceId);
    this.console.log(`Removed proxy container for ${proxy.ip}`);
  }

  /**
   * Remove all managed proxies. Call on plugin shutdown to prevent orphaned containers.
   */
  async removeAll(): Promise<void> {
    for (const id of [...this.activeProxies.keys()]) {
      await this.removeAlias(id);
    }
  }

  // ─── Docker API helpers ─────────────────────────────────────────

  private dockerApiGet<T = unknown>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { socketPath: DOCKER_SOCKET, path, method: "GET" },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try { resolve(JSON.parse(data) as T); }
            catch { reject(new Error(data.substring(0, 200))); }
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(DOCKER_API_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Docker API GET ${path} timed out after ${DOCKER_API_TIMEOUT_MS}ms`));
      });
      req.end();
    });
  }

  private dockerApiPost<T = unknown>(path: string, body: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      const req = http.request(
        {
          socketPath: DOCKER_SOCKET,
          path,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try { resolve(JSON.parse(data) as T); }
            catch { resolve({ statusCode: res.statusCode, raw: data.substring(0, 500) } as T); }
          });
        },
      );
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
