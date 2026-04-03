import { exec } from "child_process";
import http from "http";
import os from "os";
import crypto from "crypto";
import fs from "fs";

const DOCKER_SOCKET = "/var/run/docker.sock";

export class IpAliasManager {
  private console: Console;
  private activeProxies: Map<string, { ip: string; mac: string; containerId: string; proxyPort: number }> = new Map();
  private dockerAvailable: boolean | null = null;
  private networkCreated = false;
  private nextProxyPort = 18000;

  constructor(console: Console) {
    this.console = console;
  }

  detectInterface(): string | null {
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal) return name;
      }
    }
    return null;
  }

  static generateMac(deviceId: string): string {
    const hash = crypto.createHash("md5").update(`onvif-mac-${deviceId}`).digest();
    const bytes = [0x02, hash[0], hash[1], hash[2], hash[3], hash[4]];
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
  }

  static computeIp(baseIp: string, index: number): string {
    const parts = baseIp.split(".").map(Number);
    let carry = index;
    for (let i = 3; i >= 0; i--) {
      parts[i] += carry;
      carry = Math.floor(parts[i] / 256);
      parts[i] = parts[i] % 256;
    }
    return parts.join(".");
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
    for (const [name, addrs] of Object.entries(interfaces)) {
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
  private static readonly NETWORK_NAME = "onvif_cameras";

  /**
   * Create a dedicated macvlan Docker network on br0 for ONVIF proxy containers.
   * This is separate from the Scrypted container's ipvlan network (br0.2),
   * giving each proxy container a unique MAC address.
   */
  private async ensureMacvlanNetwork(parentIface: string, subnet: string, gateway: string): Promise<boolean> {
    if (this.macvlanNetworkName) return true;

    const networks: any[] = await this.dockerApiGet("/networks") || [];
    const netSummary = networks.map((n: any) => `${n.Name}(${n.Driver})`).join(", ");
    this.console.log(`Available Docker networks: ${netSummary}`);

    // Check if our dedicated network already exists
    const existing = networks.find((n: any) => n.Name === IpAliasManager.NETWORK_NAME);
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
    const containerName = `onvif-proxy-${deviceId}`;

    // Already managed
    const existing = this.activeProxies.get(deviceId);
    if (existing?.ip === ip) {
      // Check if proxy container is still running
      try {
        const info = await this.dockerApiGet(`/containers/${containerName}/json`);
        if (info?.State?.Running) {
          return { ok: true, proxyPort: existing.proxyPort };
        }
      } catch {}
    }

    // Compute network details from the assigned IP
    const ipParts = ip.split(".").map(Number);
    // Apply subnet mask to get network address
    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const mask = (~0 << (32 - prefix)) >>> 0;
    const netNum = (ipNum & mask) >>> 0;
    const subnet = `${(netNum >>> 24) & 0xff}.${(netNum >>> 16) & 0xff}.${(netNum >>> 8) & 0xff}.${netNum & 0xff}/${prefix}`;
    const gateway = gatewayOverride || `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.1`;

    // Ensure macvlan network exists on the specified parent interface
    const netOk = await this.ensureMacvlanNetwork(parentIface, subnet, gateway);
    if (!netOk) return { ok: false };

    // Allocate a unique internal port for the ONVIF server
    const proxyPort = this.allocateProxyPort();
    const scryptedIp = this.getContainerIp();

    // Remove existing proxy container if any
    await this.removeProxyContainer(containerName);

    // Ensure socat image is available (alpine + socat)
    await this.ensureSocatImage();

    // Build socat command: always proxy ONVIF (8000), optionally proxy RTSP (554+)
    let cmd: string[];
    let entrypoint: string[] | undefined;
    if (rtspTargets && rtspTargets.length > 0) {
      // Run multiple socat instances: ONVIF + one per RTSP stream
      const socatCmds = [`socat TCP-LISTEN:8000,fork,reuseaddr TCP:${scryptedIp}:${proxyPort}`];
      rtspTargets.forEach((target, idx) => {
        const listenPort = 554 + idx;
        socatCmds.push(`socat TCP-LISTEN:${listenPort},fork,reuseaddr TCP:${target.host}:${target.port}`);
      });
      // Override entrypoint to use sh directly (alpine/socat prepends "socat" to Cmd)
      entrypoint = ["/bin/sh"];
      cmd = ["-c", socatCmds.map((c) => `${c} &`).join(" ") + " wait"];
    } else {
      cmd = [`TCP-LISTEN:8000,fork,reuseaddr`, `TCP:${scryptedIp}:${proxyPort}`];
      entrypoint = undefined;
    }

    // Create proxy container on our dedicated macvlan network with unique MAC
    const containerConfig: any = {
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

    const createResult = await this.dockerApiPost(
      `/containers/create?name=${containerName}`,
      containerConfig,
    );

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

    // Wait a moment then verify it's running
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const info = await this.dockerApiGet(`/containers/${containerName}/json`);
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
    } catch (e: any) {
      this.console.error(`Failed to inspect proxy container: ${e.message}`);
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
      const images: any[] = await this.dockerApiGet("/images/json");
      const hasImage = images?.some?.((img: any) =>
        img.RepoTags?.some?.((t: string) => t.includes("socat"))
      );
      if (hasImage) return;
    } catch {}

    // Pull the image (streaming response — need to consume the full stream)
    this.console.log("Pulling alpine/socat image...");
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
            this.console.log("Image pull complete");
            resolve();
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(120000, () => reject(new Error("Image pull timeout")));
      req.end();
    });
  }

  /**
   * Remove a proxy container.
   */
  private async removeProxyContainer(name: string): Promise<void> {
    try {
      await this.dockerApiPost(`/containers/${name}/stop`, {});
    } catch {}
    await new Promise<void>((resolve) => {
      const req = http.request(
        { socketPath: DOCKER_SOCKET, path: `/containers/${name}?force=true`, method: "DELETE" },
        (res) => { res.resume(); res.on("end", () => resolve()); },
      );
      req.on("error", () => resolve());
      req.end();
    });
  }

  /**
   * Remove a proxy for a camera.
   */
  async removeAlias(deviceId: string): Promise<void> {
    const proxy = this.activeProxies.get(deviceId);
    if (!proxy) return;
    await this.removeProxyContainer(`onvif-proxy-${deviceId}`);
    this.activeProxies.delete(deviceId);
    this.console.log(`Removed proxy container for ${proxy.ip}`);
  }

  /**
   * Remove all managed proxies.
   */
  async removeAll(): Promise<void> {
    for (const id of [...this.activeProxies.keys()]) {
      await this.removeAlias(id);
    }
  }

  // ─── Docker API helpers ─────────────────────────────────────────

  private dockerApiGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { socketPath: DOCKER_SOCKET, path, method: "GET" },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error(data.substring(0, 200))); }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  private dockerApiPost(path: string, body: any): Promise<any> {
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
            try { resolve(JSON.parse(data)); }
            catch { resolve({ statusCode: res.statusCode, raw: data.substring(0, 500) }); }
          });
        },
      );
      req.on("error", reject);
      req.write(bodyStr);
      req.end();
    });
  }

  private execCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve(stdout);
      });
    });
  }
}
