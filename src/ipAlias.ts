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

export class IpAliasManager {
  private console: Console;
  private activeProxies: Map<string, { ip: string; mac: string; containerId: string; proxyPort: number }> = new Map();
  private dockerAvailable: boolean | null = null;
  private networkCreated = false;
  private nextProxyPort = 18000;
  private initLock: Promise<void> | null = null;
  private shimIp: string | null = null;
  private static readonly SHIM_IFACE = "macvlan-shim0";

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

  /**
   * Returns true when Scrypted's IP is in the same subnet as the macvlan network,
   * meaning macvlan-to-host kernel isolation will block proxy containers from reaching it.
   *
   * This covers both native installs and Docker with host networking (--network=host),
   * where Scrypted gets a LAN IP instead of a Docker bridge IP (172.x.x.x).
   * Docker bridge networking is unaffected — bridge IPs are in a different subnet.
   */
  private needsMacvlanShim(scryptedIp: string, macvlanIp: string, prefix: number): boolean {
    const toNum = (ip: string) =>
      ip.split(".").map(Number).reduce((acc, n) => ((acc << 8) | n) >>> 0, 0) >>> 0;
    const mask = (~0 << (32 - prefix)) >>> 0;
    return (toNum(scryptedIp) & mask) === (toNum(macvlanIp) & mask);
  }

  /**
   * Create a macvlan shim interface on the host so macvlan proxy containers can reach Scrypted.
   *
   * When Scrypted runs natively, its physical interface IP is unreachable from macvlan containers
   * (kernel drops macvlan→host traffic at the interface level). A shim macvlan interface gives
   * the host itself a presence on the macvlan subnet, breaking the isolation.
   *
   * The shim IP is the subnet base address + 2 (e.g. 192.168.69.2 for a 192.168.69.0/24 subnet).
   * Returns the shim IP on success, or null if creation failed.
   */
  private async ensureMacvlanShim(parentIface: string, ip: string, prefix: number, override?: string): Promise<string | null> {
    if (this.shimIp !== null) return this.shimIp;

    let shimIp: string;
    if (override) {
      shimIp = override;
    } else {
      const ipParts = ip.split(".").map(Number);
      const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
      const mask = (~0 << (32 - prefix)) >>> 0;
      const netNum = (ipNum & mask) >>> 0;
      const shimNum = netNum + 2;
      shimIp = [
        (shimNum >>> 24) & 0xff,
        (shimNum >>> 16) & 0xff,
        (shimNum >>> 8) & 0xff,
        shimNum & 0xff,
      ].join(".");
    }

    const iface = IpAliasManager.SHIM_IFACE;

    // Check if already exists via os.networkInterfaces() — no 'ip' binary needed
    if ((os.networkInterfaces()[iface] ?? []).some(a => a.family === "IPv4" && a.address === shimIp)) {
      this.console.log(`Macvlan shim ${iface} already up at ${shimIp}`);
      this.shimIp = shimIp;
      return shimIp;
    }

    // Create via a temporary privileged container using the already-pulled alpine/socat image.
    // Alpine's busybox includes 'ip', so this works even when the Scrypted image lacks iproute2.
    const cmd = [
      `ip link del ${iface} 2>/dev/null || true`,
      `ip link add ${iface} link ${parentIface} type macvlan mode bridge`,
      `ip addr add ${shimIp}/${prefix} dev ${iface}`,
      `ip link set ${iface} up`,
    ].join(" && ");

    try {
      await this.runPrivilegedCommand(cmd);
    } catch (e: unknown) {
      const msg = ((e as Error).message ?? String(e)).split("\n")[0];
      this.console.error(
        `Failed to create macvlan shim (${msg}). ` +
        `Run manually on the Scrypted host:\n` +
        `  ip link add ${iface} link ${parentIface} type macvlan mode bridge && ` +
        `ip addr add ${shimIp}/${prefix} dev ${iface} && ` +
        `ip link set ${iface} up`,
      );
      return null;
    }

    // Verify via os.networkInterfaces()
    await new Promise(r => setTimeout(r, 500));
    if ((os.networkInterfaces()[iface] ?? []).some(a => a.family === "IPv4" && a.address === shimIp)) {
      this.shimIp = shimIp;
      this.console.log(
        `Created macvlan shim ${iface} at ${shimIp}/${prefix} on ${parentIface} — ` +
        `proxy containers will use this IP to reach Scrypted`,
      );
      return shimIp;
    }

    this.console.error(
      `Shim command ran but ${iface} not visible with IP ${shimIp} — check permissions or set the shim IP manually.`,
    );
    return null;
  }

  /**
   * Run a shell command in a temporary privileged container sharing the host network namespace.
   * Uses alpine/socat (already pulled) whose busybox includes the 'ip' command.
   */
  private async runPrivilegedCommand(cmd: string): Promise<void> {
    const createResult = await this.dockerApiPost<DockerCreateResponse>("/containers/create", {
      Image: "alpine/socat:latest",
      Entrypoint: ["/bin/sh"],
      Cmd: ["-c", cmd],
      HostConfig: {
        NetworkMode: "host",
        Privileged: true,
      },
    });

    if (!createResult?.Id) {
      throw new Error(`Failed to create privileged helper container: ${JSON.stringify(createResult)}`);
    }

    const id = createResult.Id;
    try {
      await this.dockerApiPost(`/containers/${id}/start`, {});

      // Poll until the container exits (max 15 seconds)
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 300));
        const info = await this.dockerApiGet<DockerContainerInfo>(`/containers/${id}/json`);
        if (!info?.State?.Running) {
          if ((info?.State?.ExitCode ?? 0) !== 0) {
            throw new Error(`Privileged helper exited with code ${info?.State?.ExitCode}`);
          }
          return;
        }
      }
      throw new Error("Privileged helper container timed out after 15 seconds");
    } finally {
      await new Promise<void>((resolve) => {
        const req = http.request(
          { socketPath: DOCKER_SOCKET, path: `/containers/${id}?force=true`, method: "DELETE" },
          (res) => { res.resume(); res.on("end", () => resolve()); },
        );
        req.on("error", () => resolve());
        req.setTimeout(DOCKER_API_TIMEOUT_MS, () => resolve());
        req.end();
      });
    }
  }

  private async removeShim(): Promise<void> {
    if (!this.shimIp) return;
    const iface = IpAliasManager.SHIM_IFACE;
    try {
      await this.runPrivilegedCommand(`ip link del ${iface} 2>/dev/null || true`);
      this.console.log(`Removed macvlan shim ${iface}`);
    } catch {
      // Best effort
    }
    this.shimIp = null;
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
   * Allocate a unique port for the ONVIF server to listen on internally.
   * This port is proxied through the macvlan proxy container.
   */
  allocateProxyPort(): number {
    return this.nextProxyPort++;
  }

  private macvlanNetworkName: string | null = null;
  private macvlanGateway: string | null = null;
  private static readonly NETWORK_NAME = "onvif_cameras";

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
  private async ensureMacvlanNetwork(parentIface: string, subnet: string, gateway: string): Promise<boolean> {
    if (this.macvlanNetworkName) return true;

    const networks = (await this.dockerApiGet<DockerNetwork[]>("/networks")) || [];
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
  async addAlias(
    deviceId: string,
    ip: string,
    parentIface: string,
    prefix: number,
    gatewayOverride?: string,
    rtspTargets?: { port: number; host: string }[],
    shimIpOverride?: string,
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
      this.macvlanGateway = gateway;

      // Ensure macvlan network exists on the specified parent interface
      const netOk = await this.ensureMacvlanNetwork(parentIface, subnet, gateway);
      if (!netOk) return false;

      // When Scrypted's IP is on the same subnet as the macvlan network (native install or
      // Docker with --network=host), macvlan containers cannot reach it directly due to
      // kernel macvlan-to-host isolation. Create a shim interface so they can.
      const hostIpForCheck = this.getContainerIp();
      if (this.needsMacvlanShim(hostIpForCheck, ip, prefix)) {
        await this.ensureMacvlanShim(parentIface, ip, prefix, shimIpOverride);
      }

      // Ensure socat image is available
      await this.ensureSocatImage();
      return true;
    });

    if (!initOk) return { ok: false };

    // Allocate a unique internal port for the ONVIF server
    const proxyPort = this.allocateProxyPort();
    let scryptedIp = this.getContainerIp();
    let needsGatewayRoute = false;
    if (this.needsMacvlanShim(scryptedIp, ip, prefix)) {
      if (this.shimIp) {
        // Shim created successfully — proxy containers use the shim IP to reach Scrypted
        scryptedIp = this.shimIp;
      } else if (this.macvlanGateway) {
        // Shim unavailable (e.g. VM hypervisor blocks macvlan-to-macvlan traffic).
        // Add a host-specific route in each proxy container so traffic to Scrypted goes
        // via the gateway instead of direct ARP, bypassing macvlan-to-host isolation.
        needsGatewayRoute = true;
        this.console.log(
          `Scrypted IP ${scryptedIp} is on the macvlan subnet and shim is unavailable. ` +
          `Adding gateway route (via ${this.macvlanGateway}) in proxy containers.`,
        );
      } else {
        this.console.warn(
          `Scrypted IP ${scryptedIp} is on the macvlan subnet — shim creation failed. ` +
          `Falling back to host IP. ONVIF adoption may fail.`,
        );
      }
    }

    // Remove existing proxy container if any
    await this.removeProxyContainer(containerName);

    // Build socat command: always proxy ONVIF (8000), optionally proxy RTSP (554+)
    // Validate hostnames/ports to prevent shell injection
    const sanitizeHost = (h: string) => {
      if (!/^[a-zA-Z0-9._-]+$/.test(h)) throw new Error(`Invalid hostname: ${h}`);
      return h;
    };
    const sanitizePort = (p: number) => {
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Invalid port: ${p}`);
      return p;
    };

    // When using the gateway route fallback, prefix the sh command with the route setup.
    // busybox 'ip' is available in alpine/socat; '|| true' makes it idempotent on restart.
    const routePrefix = needsGatewayRoute && this.macvlanGateway
      ? `ip route add ${sanitizeHost(scryptedIp)}/32 via ${sanitizeHost(this.macvlanGateway)} 2>/dev/null || true && `
      : '';

    let cmd: string[];
    const entrypoint = ["/bin/sh"];
    if (rtspTargets && rtspTargets.length > 0) {
      // Run multiple socat instances: ONVIF + one per RTSP stream
      const socatCmds = [`socat TCP-LISTEN:8000,fork,reuseaddr TCP:${sanitizeHost(scryptedIp)}:${sanitizePort(proxyPort)}`];
      rtspTargets.forEach((target, idx) => {
        const listenPort = 554 + idx;
        socatCmds.push(`socat TCP-LISTEN:${sanitizePort(listenPort)},fork,reuseaddr TCP:${sanitizeHost(scryptedIp)}:${sanitizePort(target.port)}`);
      });
      cmd = ["-c", routePrefix + socatCmds.map((c) => `${c} &`).join(" ") + " wait"];
    } else {
      cmd = ["-c", `${routePrefix}socat TCP-LISTEN:8000,fork,reuseaddr TCP:${sanitizeHost(scryptedIp)}:${sanitizePort(proxyPort)}`];
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
        // NET_ADMIN required when adding a host-specific route at container startup
        ...(needsGatewayRoute ? { CapAdd: ["NET_ADMIN"] } : {}),
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
    await this.removeShim();
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
