import http from "http";
import dgram from "dgram";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { OnvifEvent, OnvifServiceConfig, RtspStreamInfo } from "./types";

const ONVIF_DEVICE_NS = "http://www.onvif.org/ver10/device/wsdl";
const ONVIF_MEDIA_NS = "http://www.onvif.org/ver10/media/wsdl";
const ONVIF_PTZ_NS = "http://www.onvif.org/ver20/ptz/wsdl";
const ONVIF_EVENT_NS = "http://www.onvif.org/ver10/events/wsdl";
const ONVIF_IMAGING_NS = "http://www.onvif.org/ver20/imaging/wsdl";
const ONVIF_SCHEMA_NS = "http://www.onvif.org/ver10/schema";
const WS_DISCOVERY_PORT = 3702;
const WS_DISCOVERY_ADDR = "239.255.255.250";

function soapEnvelope(body: string): string {
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

interface PullPointSubscription {
  id: string;
  events: OnvifEvent[];
  createdAt: Date;
  terminationTime: Date;
}

const MAX_EVENTS_PER_SUBSCRIPTION = 200;

export class OnvifServer {
  private server: http.Server | null = null;
  private discoverySocket: dgram.Socket | null = null;
  private responseSocket: dgram.Socket | null = null;
  private console: Console;
  private config: OnvifServiceConfig;
  private deviceUuid: string;
  private assignedPort: number = 0;
  private subscriptions: Map<string, PullPointSubscription> = new Map();

  constructor(console: Console, config: OnvifServiceConfig) {
    this.console = console;
    this.config = config;
    // Deterministic UUID based on device ID so the same camera always has the same endpoint
    const hash = crypto
      .createHash("sha256")
      .update(`scrypted-onvif-${config.deviceId}`)
      .digest("hex");
    this.deviceUuid = `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  updateStreams(streams: RtspStreamInfo[]) {
    this.config.streams = streams;
  }

  pushEvent(event: OnvifEvent) {
    for (const sub of this.subscriptions.values()) {
      sub.events.push(event);
      // Trim old events
      if (sub.events.length > MAX_EVENTS_PER_SUBSCRIPTION) {
        sub.events.splice(0, sub.events.length - MAX_EVENTS_PER_SUBSCRIPTION);
      }
    }
  }

  async start(port: number): Promise<number> {
    if (this.server) {
      await this.stop();
    }

    // If port is 0, derive a deterministic port from the device ID (range 10000-60000)
    // so the same camera always gets the same port across restarts.
    if (port === 0) {
      const hash = crypto
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
      } catch (err: any) {
        if (err?.code === "EADDRINUSE" && attempt < 2) {
          this.console.warn(
            `Port ${port} in use for ${this.config.deviceName}, retrying in 1s... (attempt ${attempt + 1}/3)`,
          );
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        if (err?.code === "EADDRINUSE") {
          this.console.warn(
            `Port ${port} still in use for ${this.config.deviceName}, using random port`,
          );
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
  private get serviceIp(): string {
    return this.config.onvifIp || this.config.hostname;
  }

  /** The port that external clients see (8000 in proxy mode, actual port otherwise) */
  private get servicePort(): number {
    return this.config.proxyMode ? 8000 : this.assignedPort;
  }

  private tryListen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
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
        const addr = server.address() as any;
        this.assignedPort = addr?.port ?? port;
        this.console.log(
          `ONVIF server for ${this.config.deviceName} listening on port ${this.assignedPort}`,
        );
        this.startDiscovery();
        resolve(this.assignedPort);
      });
    });
  }

  async stop(): Promise<void> {
    this.stopDiscovery();
    this.subscriptions.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.console.log(
            `ONVIF server stopped for ${this.config.deviceName}`,
          );
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  get isRunning(): boolean {
    return this.server !== null;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Handle snapshot requests (non-SOAP, plain HTTP GET)
    const url = req.url ?? "/";
    if (req.method === "GET" && url.startsWith("/snapshot")) {
      this.handleSnapshotRequest(req, res);
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const response = this.routeSoapRequest(body, url, req);
        res.writeHead(200, {
          "Content-Type": "application/soap+xml; charset=utf-8",
        });
        res.end(response);
      } catch (e) {
        this.console.error("ONVIF request error", (e as Error).message);
        res.writeHead(500, {
          "Content-Type": "application/soap+xml; charset=utf-8",
        });
        res.end(this.soapFault("Server", (e as Error).message));
      }
    });
  }

  private async handleSnapshotRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.config.getSnapshot) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Snapshot not available");
      return;
    }

    try {
      const jpegBuffer = await this.config.getSnapshot();
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": jpegBuffer.length,
        "Cache-Control": "no-cache",
      });
      res.end(jpegBuffer);
    } catch (e) {
      this.console.error("Snapshot error", (e as Error).message);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Snapshot failed");
    }
  }

  private routeSoapRequest(
    body: string,
    url: string,
    req?: http.IncomingMessage,
  ): string {
    // These endpoints are always unauthenticated (needed for initial discovery/capability negotiation)
    if (body.includes("GetSystemDateAndTime"))
      return this.getSystemDateAndTime();
    if (body.includes("GetCapabilities")) return this.getCapabilities();
    if (body.includes("GetServices")) return this.getServices();
    if (body.includes("GetDeviceInformation"))
      return this.getDeviceInformation();
    if (body.includes("GetScopes")) return this.getScopes();
    if (body.includes("GetNetworkInterfaces"))
      return this.getNetworkInterfaces();

    // Validate credentials (WS-Security in SOAP body or HTTP Basic/Digest in headers)
    const authError = this.validateAuth(body, req);
    if (authError) return authError;

    // ─── Media Service ───────────────────────────────────────────
    if (body.includes("GetProfiles")) return this.getProfiles();
    if (body.includes("GetStreamUri")) return this.getStreamUri(body);
    if (body.includes("GetSnapshotUri")) return this.getSnapshotUri(body);
    if (body.includes("GetVideoSources")) return this.getVideoSources();
    if (body.includes("GetVideoSourceConfigurations"))
      return this.getVideoSourceConfigurations();
    if (body.includes("GetAudioSources")) return this.getAudioSources();
    if (body.includes("GetAudioSourceConfigurations"))
      return this.getAudioSourceConfigurations();
    if (body.includes("GetAudioOutputs")) return this.getAudioOutputs();
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
    if (body.includes("GetNodes")) return this.getPtzNodes();
    if (body.includes("GetNode") && !body.includes("GetNodes"))
      return this.getPtzNode(body);
    if (body.includes("ContinuousMove")) return this.ptzContinuousMove(body);
    if (body.includes("AbsoluteMove")) return this.ptzAbsoluteMove(body);
    if (body.includes("RelativeMove")) return this.ptzRelativeMove(body);
    if (body.includes("Stop") && url.includes("ptz")) return this.ptzStop(body);
    if (body.includes("GotoHomePosition")) return this.ptzGotoHome(body);
    if (body.includes("GotoPreset")) return this.ptzGotoPreset(body);
    if (body.includes("GetPresets")) return this.ptzGetPresets(body);
    if (body.includes("GetStatus") && url.includes("ptz"))
      return this.ptzGetStatus(body);

    // ─── Event Service ───────────────────────────────────────────
    if (body.includes("GetEventProperties")) return this.getEventProperties();
    if (body.includes("GetServiceCapabilities") && url.includes("event"))
      return this.getEventServiceCapabilities();
    if (body.includes("CreatePullPointSubscription"))
      return this.createPullPointSubscription();
    if (body.includes("PullMessages")) return this.pullMessages(body);
    if (body.includes("Unsubscribe")) return this.unsubscribe(body);
    if (body.includes("Renew")) return this.renewSubscription(body);

    this.console.warn(`Unhandled ONVIF request: ${body.substring(0, 300)}...`);
    return this.soapFault("Sender", "Action not supported");
  }

  /**
   * Validate authentication from WS-Security (SOAP body) or HTTP Basic auth headers.
   * Returns a SOAP fault string if auth fails, or null if OK.
   */
  private validateAuth(
    body: string,
    req?: http.IncomingMessage,
  ): string | null {
    const { username, password } = this.config;
    if (!username) return null;

    // 1. Try WS-Security UsernameToken in SOAP body
    const wsUsername = this.extractValue(body, "Username");
    if (wsUsername) {
      if (wsUsername !== username) {
        return this.soapFault("Sender", "Not authorized: invalid credentials");
      }

      const wsPassword = this.extractValue(body, "Password");
      const wsNonce = this.extractValue(body, "Nonce");
      const wsCreated = this.extractValue(body, "Created");

      // WS-Security Password Digest: Base64(SHA1(Nonce + Created + Password))
      if (wsNonce && wsCreated && password) {
        const nonceBuffer = Buffer.from(wsNonce, "base64");
        const hash = crypto.createHash("sha1");
        hash.update(nonceBuffer);
        hash.update(wsCreated);
        hash.update(password);
        const expectedDigest = hash.digest("base64");

        if (wsPassword === expectedDigest) {
          return null;
        }
      }

      // Fallback: plain-text password comparison
      if (wsPassword === password) {
        return null;
      }

      return this.soapFault("Sender", "Not authorized: invalid credentials");
    }

    // 2. Try HTTP Basic auth header
    const authHeader = req?.headers?.["authorization"];
    if (authHeader?.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
      const [httpUser, httpPass] = decoded.split(":");
      if (httpUser === username && httpPass === password) {
        return null;
      }
      return this.soapFault("Sender", "Not authorized: invalid credentials");
    }

    // No credentials provided
    return this.soapFault("Sender", "Not authorized: missing credentials");
  }

  // ─── Device Service ──────────────────────────────────────────────

  private getDeviceInformation(): string {
    return soapEnvelope(`
    <tds:GetDeviceInformationResponse>
      <tds:Manufacturer>${this.escXml(this.config.manufacturer)}</tds:Manufacturer>
      <tds:Model>${this.escXml(this.config.model)}</tds:Model>
      <tds:FirmwareVersion>${this.escXml(this.config.firmwareVersion)}</tds:FirmwareVersion>
      <tds:SerialNumber>${this.escXml(this.config.serialNumber)}</tds:SerialNumber>
      <tds:HardwareId>${this.escXml(this.config.serialNumber)}</tds:HardwareId>
    </tds:GetDeviceInformationResponse>`);
  }

  private getCapabilities(): string {
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
    if (
      caps.hasMotionSensor ||
      caps.hasAudioSensor ||
      caps.hasObjectDetection
    ) {
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

  private getServices(): string {
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

    if (
      caps.hasMotionSensor ||
      caps.hasAudioSensor ||
      caps.hasObjectDetection
    ) {
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

  private getSystemDateAndTime(): string {
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

  private getScopes(): string {
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

  private getNetworkInterfaces(): string {
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
  private generateMac(): string {
    const hash = crypto
      .createHash("md5")
      .update(`onvif-mac-${this.config.deviceId}`)
      .digest();
    const bytes = [0x02, hash[0], hash[1], hash[2], hash[3], hash[4]];
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
  }

  // ─── Media Service ───────────────────────────────────────────────

  private getProfiles(): string {
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

  private getStreamUri(body: string): string {
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

  private getSnapshotUri(body: string): string {
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

  private getVideoSources(): string {
    const sources = this.config.streams.map(
      (stream, idx) => `
      <trt:VideoSources token="video_src_${idx}">
        <tt:Framerate>25</tt:Framerate>
        <tt:Resolution>
          <tt:Width>${stream.width ?? 1920}</tt:Width>
          <tt:Height>${stream.height ?? 1080}</tt:Height>
        </tt:Resolution>
      </trt:VideoSources>`,
    );

    return soapEnvelope(`
    <trt:GetVideoSourcesResponse>${sources.join("")}
    </trt:GetVideoSourcesResponse>`);
  }

  private getVideoSourceConfigurations(): string {
    const configs = this.config.streams.map(
      (stream, idx) => `
      <trt:Configurations token="vsrc_${idx}">
        <tt:Name>VideoSource_${idx}</tt:Name>
        <tt:UseCount>1</tt:UseCount>
        <tt:SourceToken>video_src_${idx}</tt:SourceToken>
        <tt:Bounds x="0" y="0" width="${stream.width ?? 1920}" height="${stream.height ?? 1080}"/>
      </trt:Configurations>`,
    );

    return soapEnvelope(`
    <trt:GetVideoSourceConfigurationsResponse>${configs.join("")}
    </trt:GetVideoSourceConfigurationsResponse>`);
  }

  private getVideoEncoderConfigurations(): string {
    const configs = this.config.streams.map(
      (stream, idx) => `
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
      </trt:Configurations>`,
    );

    return soapEnvelope(`
    <trt:GetVideoEncoderConfigurationsResponse>${configs.join("")}
    </trt:GetVideoEncoderConfigurationsResponse>`);
  }

  // ─── Audio Sources & Outputs ─────────────────────────────────────

  private getAudioSources(): string {
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

  private getAudioSourceConfigurations(): string {
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

  private getAudioEncoderConfigurations(): string {
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

  private getAudioOutputs(): string {
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

  private getAudioOutputConfigurations(): string {
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

  private getAudioDecoderConfigurations(): string {
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

  private getPtzConfigurations(): string {
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

  private getPtzConfiguration(body: string): string {
    return this.getPtzConfigurations();
  }

  private getPtzNodes(): string {
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

  private getPtzNode(body: string): string {
    return this.getPtzNodes();
  }

  private ptzContinuousMove(body: string): string {
    if (!this.config.capabilities.hasPtz) {
      return this.soapFault("Sender", "PTZ not supported");
    }
    // Log the PTZ command — actual movement is handled by the Scrypted device
    this.console.log(
      `PTZ ContinuousMove request for ${this.config.deviceName}`,
    );
    return soapEnvelope(`<tptz:ContinuousMoveResponse/>`);
  }

  private ptzAbsoluteMove(body: string): string {
    if (!this.config.capabilities.hasPtz) {
      return this.soapFault("Sender", "PTZ not supported");
    }
    this.console.log(`PTZ AbsoluteMove request for ${this.config.deviceName}`);
    return soapEnvelope(`<tptz:AbsoluteMoveResponse/>`);
  }

  private ptzRelativeMove(body: string): string {
    if (!this.config.capabilities.hasPtz) {
      return this.soapFault("Sender", "PTZ not supported");
    }
    this.console.log(`PTZ RelativeMove request for ${this.config.deviceName}`);
    return soapEnvelope(`<tptz:RelativeMoveResponse/>`);
  }

  private ptzStop(body: string): string {
    if (!this.config.capabilities.hasPtz) {
      return this.soapFault("Sender", "PTZ not supported");
    }
    this.console.log(`PTZ Stop request for ${this.config.deviceName}`);
    return soapEnvelope(`<tptz:StopResponse/>`);
  }

  private ptzGotoHome(body: string): string {
    if (!this.config.capabilities.hasPtz) {
      return this.soapFault("Sender", "PTZ not supported");
    }
    this.console.log(`PTZ GotoHome request for ${this.config.deviceName}`);
    return soapEnvelope(`<tptz:GotoHomePositionResponse/>`);
  }

  private ptzGotoPreset(body: string): string {
    if (!this.config.capabilities.hasPtz) {
      return this.soapFault("Sender", "PTZ not supported");
    }
    const presetToken = this.extractValue(body, "PresetToken");
    this.console.log(
      `PTZ GotoPreset ${presetToken} request for ${this.config.deviceName}`,
    );
    return soapEnvelope(`<tptz:GotoPresetResponse/>`);
  }

  private ptzGetPresets(body: string): string {
    if (!this.config.capabilities.hasPtz) {
      return soapEnvelope(`<tptz:GetPresetsResponse/>`);
    }

    // Return empty presets — real presets would come from the Scrypted device
    return soapEnvelope(`<tptz:GetPresetsResponse/>`);
  }

  private ptzGetStatus(body: string): string {
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

  private getEventProperties(): string {
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

  private getEventServiceCapabilities(): string {
    return soapEnvelope(`
    <tev:GetServiceCapabilitiesResponse>
      <tev:Capabilities WSSubscriptionPolicySupport="false"
                         WSPullPointSupport="true"
                         WSPausableSubscriptionManagerInterfaceSupport="false"/>
    </tev:GetServiceCapabilitiesResponse>`);
  }

  private createPullPointSubscription(): string {
    const subId = uuidv4();
    const now = new Date();
    const terminationTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

    this.subscriptions.set(subId, {
      id: subId,
      events: [],
      createdAt: now,
      terminationTime,
    });

    this.console.log(
      `PullPoint subscription created: ${subId} for ${this.config.deviceName}`,
    );

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

  private pullMessages(body: string): string {
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
          const simpleItem =
            typeof value === "boolean"
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

  private unsubscribe(body: string): string {
    const subId = this.findSubscriptionId(body);
    if (subId) {
      this.subscriptions.delete(subId);
      this.console.log(`PullPoint subscription removed: ${subId}`);
    }
    return soapEnvelope(`<tev:UnsubscribeResponse/>`);
  }

  private renewSubscription(body: string): string {
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
  private findSubscriptionId(body: string): string | null {
    // Look in Address or To header for ?sub=<uuid>
    const subMatch = body.match(/[?&]sub=([a-f0-9-]+)/i);
    if (subMatch) return subMatch[1];

    // Fall back to first subscription
    return null;
  }

  // ─── WS-Discovery ────────────────────────────────────────────────

  private startDiscovery() {
    try {
      // Listener socket: receives multicast probes on 0.0.0.0:3702
      this.discoverySocket = dgram.createSocket({
        type: "udp4",
        reuseAddr: true,
      });

      this.discoverySocket.on("error", (err) => {
        this.console.warn(
          `WS-Discovery socket error for ${this.config.deviceName}: ${err.message}`,
        );
      });

      this.discoverySocket.on("message", (msg, rinfo) => {
        const message = msg.toString();
        if (
          message.includes("Probe") &&
          message.includes("NetworkVideoTransmitter")
        ) {
          const messageIdMatch = message.match(
            /<[^>]*MessageID[^>]*>([^<]+)<\//,
          );
          const probeMessageId = messageIdMatch?.[1] ?? `urn:uuid:${uuidv4()}`;
          this.sendProbeMatch(rinfo, probeMessageId);
        }
      });

      this.discoverySocket.bind(WS_DISCOVERY_PORT, () => {
        try {
          this.discoverySocket!.addMembership(WS_DISCOVERY_ADDR);
          this.console.log(`WS-Discovery active for ${this.config.deviceName}`);
        } catch (e) {
          this.console.warn(
            `Failed to join multicast group: ${(e as Error).message}`,
          );
        }
      });

      // Response socket: bound to this camera's unique IP so ProbeMatch
      // packets have the correct source address. NVRs like UniFi identify
      // cameras by the source IP of the UDP response, not the XML content.
      if (this.config.onvifIp && !this.config.proxyMode) {
        this.responseSocket = dgram.createSocket({
          type: "udp4",
          reuseAddr: true,
        });
        this.responseSocket.on("error", (err) => {
          this.console.warn(
            `Response socket error for ${this.config.deviceName}: ${err.message}`,
          );
        });
        this.responseSocket.bind(0, this.config.onvifIp, () => {
          this.console.log(
            `WS-Discovery response socket bound to ${this.config.onvifIp} for ${this.config.deviceName}`,
          );
        });
      }
    } catch (e) {
      this.console.warn(
        `Failed to start WS-Discovery for ${this.config.deviceName}: ${(e as Error).message}`,
      );
    }
  }

  private stopDiscovery() {
    if (this.discoverySocket) {
      try {
        this.sendBye();
      } catch {
        /* ignore */
      }
      try {
        this.discoverySocket.close();
      } catch {
        /* ignore */
      }
      this.discoverySocket = null;
    }
    if (this.responseSocket) {
      try {
        this.responseSocket.close();
      } catch {
        /* ignore */
      }
      this.responseSocket = null;
    }
  }

  private sendBye() {
    if (!this.discoverySocket) return;

    const bye = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
    xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
    xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Bye</a:Action>
    <a:MessageID>urn:uuid:${uuidv4()}</a:MessageID>
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
    sock!.send(
      buf,
      0,
      buf.length,
      WS_DISCOVERY_PORT,
      WS_DISCOVERY_ADDR,
      (err) => {
        if (err) {
          this.console.warn(`Failed to send Bye: ${err.message}`);
        }
      },
    );
  }

  private sendProbeMatch(rinfo: dgram.RemoteInfo, probeMessageId: string) {
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
    sock?.send(
      buf,
      0,
      buf.length,
      rinfo.port,
      rinfo.address,
      (err) => {
        if (err) {
          this.console.warn(`Failed to send ProbeMatch: ${err.message}`);
        } else {
          this.console.log(`Sent ProbeMatch from ${this.serviceIp} to ${rinfo.address}:${rinfo.port} for ${this.config.deviceName}`);
        }
      },
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private getStreamByProfileToken(token: string): RtspStreamInfo | null {
    if (!token) return this.config.streams[0] ?? null;
    const match = token.match(/profile_(\d+)/);
    if (match) {
      const idx = parseInt(match[1], 10);
      return this.config.streams[idx] ?? null;
    }
    return this.config.streams[0] ?? null;
  }

  private extractValue(xml: string, tag: string): string {
    // Match tag with optional namespace prefix, ensuring exact tag name (not UsernameToken when looking for Username)
    const regex = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([^<]*)<`, "i");
    const match = xml.match(regex);
    return match?.[1]?.trim() ?? "";
  }

  private escXml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private soapFault(code: string, reason: string): string {
    return soapEnvelope(`
    <s:Fault>
      <s:Code><s:Value>s:${code}</s:Value></s:Code>
      <s:Reason><s:Text xml:lang="en">${this.escXml(reason)}</s:Text></s:Reason>
    </s:Fault>`);
  }
}
