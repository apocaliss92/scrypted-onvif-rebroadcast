/**
 * ONVIF Discovery & Service Test Script
 *
 * Usage: npx ts-node scripts/test-onvif-discovery.ts [ip] [port]
 *   defaults: 192.168.1.4 38911
 */

import dgram from "dgram";
import http from "http";
import crypto from "crypto";

const HOST = process.argv[2] || "192.168.1.4";
const PORT = parseInt(process.argv[3] || "38911", 10);
const BASE = `http://${HOST}:${PORT}`;

const MULTICAST_ADDR = "239.255.255.250";
const MULTICAST_PORT = 3702;

// ─── Helpers ────────────────────────────────────────────────────────────

function soapRequest(path: string, body: string, auth?: { username: string; password: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "Content-Type": "application/soap+xml; charset=utf-8" };
    if (auth) {
      headers["Authorization"] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
    }
    const req = http.request(
      { hostname: HOST, port: PORT, path, method: "POST", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}\n${data}`));
          } else {
            resolve(data);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function envelope(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema"
  xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <s:Body>${bodyXml}</s:Body>
</s:Envelope>`;
}

function envelopeWithAuth(bodyXml: string, username: string, password: string): string {
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const digest = crypto
    .createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)]))
    .digest("base64");

  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema"
  xmlns:tev="http://www.onvif.org/ver10/events/wsdl"
  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
  xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</wsse:Nonce>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </s:Header>
  <s:Body>${bodyXml}</s:Body>
</s:Envelope>`;
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<[^>]*?${tag}[^>]*?>([\\s\\S]*?)</[^>]*?${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function printSection(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function printResult(label: string, value: string | null | undefined) {
  console.log(`  ${label.padEnd(25)} ${value ?? "(not found)"}`);
}

// ─── Tests ──────────────────────────────────────────────────────────────

async function testWsDiscovery(): Promise<void> {
  printSection("WS-Discovery Probe (multicast)");

  const messageId = `urn:uuid:${crypto.randomUUID()}`;
  const probe = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>${messageId}</a:MessageID>
    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>`;

  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let answered = false;

    const timeout = setTimeout(() => {
      if (!answered) {
        console.log("  No ProbeMatch received within 5s");
      }
      socket.close();
      resolve();
    }, 5000);

    socket.on("message", (msg, rinfo) => {
      answered = true;
      const xml = msg.toString();
      console.log(`  ProbeMatch from ${rinfo.address}:${rinfo.port}`);

      const addr = extractTag(xml, "XAddrs");
      const types = extractTag(xml, "Types");
      const scopes = extractTag(xml, "Scopes");
      const relatesTo = extractTag(xml, "RelatesTo");

      printResult("XAddrs", addr);
      printResult("Types", types);
      printResult("Scopes", scopes?.split(" ").join("\n" + " ".repeat(27)));
      printResult("RelatesTo", relatesTo);
      printResult("Matches MessageID", relatesTo === messageId ? "YES" : "NO");
    });

    socket.bind(0, () => {
      socket.addMembership(MULTICAST_ADDR);
      socket.send(probe, 0, probe.length, MULTICAST_PORT, MULTICAST_ADDR, (err) => {
        if (err) {
          console.log(`  Send error: ${err.message}`);
          clearTimeout(timeout);
          socket.close();
          resolve();
        } else {
          console.log(`  Probe sent (MessageID: ${messageId})`);
        }
      });
    });
  });
}

async function testGetSystemDateAndTime(): Promise<void> {
  printSection("GetSystemDateAndTime (no auth)");
  try {
    const res = await soapRequest("/onvif/device_service", envelope("<tds:GetSystemDateAndTime/>"));
    const utc = extractTag(res, "UTCDateTime");
    console.log(`  OK - response received`);
    if (utc) console.log(`  UTC: ${utc.replace(/\s+/g, " ").trim()}`);
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
  }
}

async function testGetDeviceInformation(): Promise<void> {
  printSection("GetDeviceInformation (no auth)");
  try {
    const res = await soapRequest("/onvif/device_service", envelope("<tds:GetDeviceInformation/>"));
    printResult("Manufacturer", extractTag(res, "Manufacturer"));
    printResult("Model", extractTag(res, "Model"));
    printResult("FirmwareVersion", extractTag(res, "FirmwareVersion"));
    printResult("SerialNumber", extractTag(res, "SerialNumber"));
    printResult("HardwareId", extractTag(res, "HardwareId"));
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
  }
}

async function testGetCapabilities(): Promise<void> {
  printSection("GetCapabilities (no auth)");
  try {
    const res = await soapRequest("/onvif/device_service", envelope("<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>"));
    const mediaXAddr = extractTag(res, "Media");
    const eventsXAddr = extractTag(res, "Events");
    const ptzXAddr = extractTag(res, "PTZ");
    console.log(`  OK - capabilities received`);
    if (mediaXAddr) printResult("Media XAddr", extractTag(mediaXAddr, "XAddr"));
    if (eventsXAddr) printResult("Events XAddr", extractTag(eventsXAddr, "XAddr"));
    if (ptzXAddr) printResult("PTZ XAddr", extractTag(ptzXAddr, "XAddr"));
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
  }
}

async function testGetProfiles(username?: string, password?: string): Promise<string | null> {
  printSection("GetProfiles (auth)");
  try {
    const auth = username && password ? { username, password } : undefined;
    const res = await soapRequest("/onvif/media_service", envelope("<trt:GetProfiles/>"), auth);
    const profiles = res.match(/<[^>]*?Profiles[^>]*?token="([^"]+)"/g) ?? [];
    console.log(`  Found ${profiles.length} profile(s)`);
    let firstToken: string | null = null;
    for (const p of profiles) {
      const token = p.match(/token="([^"]+)"/)?.[1];
      if (token) {
        if (!firstToken) firstToken = token;
        const name = extractTag(res.substring(res.indexOf(p)), "Name");
        const width = extractTag(res.substring(res.indexOf(p)), "Width");
        const height = extractTag(res.substring(res.indexOf(p)), "Height");
        console.log(`  - ${token}: ${name ?? "?"} (${width ?? "?"}x${height ?? "?"})`);
      }
    }
    return firstToken;
  } catch (e: any) {
    console.log(`  FAIL: ${e.message.split("\n")[0]}`);
    return null;
  }
}

async function testGetStreamUri(profileToken: string, username?: string, password?: string): Promise<void> {
  printSection(`GetStreamUri (profile: ${profileToken})`);
  try {
    const bodyXml = `<trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>${profileToken}</trt:ProfileToken>
    </trt:GetStreamUri>`;
    const auth = username && password ? { username, password } : undefined;
    const res = await soapRequest("/onvif/media_service", envelope(bodyXml), auth);
    const uri = extractTag(res, "Uri");
    printResult("Stream URI", uri);
  } catch (e: any) {
    console.log(`  FAIL: ${e.message.split("\n")[0]}`);
  }
}

async function testGetServices(): Promise<void> {
  printSection("GetServices (no auth)");
  try {
    const res = await soapRequest(
      "/onvif/device_service",
      envelope("<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>")
    );
    const namespaces = res.match(/<[^>]*?Namespace[^>]*?>(.*?)<\/[^>]*?Namespace>/g) ?? [];
    for (const ns of namespaces) {
      const val = ns.replace(/<[^>]+>/g, "").trim();
      const xaddr = extractTag(res.slice(res.indexOf(ns)), "XAddr");
      console.log(`  ${val}`);
      if (xaddr) console.log(`    -> ${xaddr}`);
    }
    if (namespaces.length === 0) console.log("  No services found in response");
  } catch (e: any) {
    console.log(`  FAIL: ${e.message.split("\n")[0]}`);
  }
}

async function testGetScopes(): Promise<void> {
  printSection("GetScopes (no auth)");
  try {
    const res = await soapRequest("/onvif/device_service", envelope("<tds:GetScopes/>"));
    const items = res.match(/<[^>]*?ScopeItem[^>]*?>(.*?)<\/[^>]*?ScopeItem>/g) ?? [];
    for (const item of items) {
      const val = item.replace(/<[^>]+>/g, "").trim();
      console.log(`  ${val}`);
    }
    if (items.length === 0) console.log("  No scopes found");
  } catch (e: any) {
    console.log(`  FAIL: ${e.message.split("\n")[0]}`);
  }
}

async function testCreatePullPointSubscription(username?: string, password?: string): Promise<void> {
  printSection("CreatePullPointSubscription (auth)");
  try {
    const auth = username && password ? { username, password } : undefined;
    const bodyXml = `<tev:CreatePullPointSubscription>
      <tev:InitialTerminationTime>PT60S</tev:InitialTerminationTime>
    </tev:CreatePullPointSubscription>`;
    const res = await soapRequest("/onvif/event_service", envelope(bodyXml), auth);
    const subRef = extractTag(res, "SubscriptionReference");
    const addr = subRef ? extractTag(subRef, "Address") : null;
    printResult("Subscription Address", addr);

    if (addr) {
      console.log("\n  Pulling messages...");
      const pullXml = `<tev:PullMessages>
        <tev:Timeout>PT5S</tev:Timeout>
        <tev:MessageLimit>10</tev:MessageLimit>
      </tev:PullMessages>`;
      const url = new URL(addr);
      const pullRes = await soapRequest(url.pathname, envelope(pullXml), auth);
      const msgs = pullRes.match(/<[^>]*?NotificationMessage/g) ?? [];
      console.log(`  Got ${msgs.length} event message(s)`);
      if (msgs.length > 0) {
        console.log(`  ${pullRes.substring(0, 500)}...`);
      }
    }
  } catch (e: any) {
    console.log(`  FAIL: ${e.message.split("\n")[0]}`);
  }
}

async function testDirectHttp(): Promise<void> {
  printSection("Direct HTTP GET /onvif/device_service");
  return new Promise((resolve) => {
    http.get(`${BASE}/onvif/device_service`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        console.log(`  Status: ${res.statusCode}`);
        console.log(`  Body: ${data.substring(0, 200)}${data.length > 200 ? "..." : ""}`);
        resolve();
      });
    }).on("error", (e) => {
      console.log(`  FAIL: ${e.message}`);
      resolve();
    });
  });
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nONVIF Discovery & Service Test`);
  console.log(`Target: ${BASE}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Optional auth from env
  const username = process.env.ONVIF_USER;
  const password = process.env.ONVIF_PASS;
  if (username) console.log(`Auth: ${username} / ****`);
  else console.log(`Auth: none (set ONVIF_USER / ONVIF_PASS env vars to test with auth)`);

  await testDirectHttp();
  await testWsDiscovery();
  await testGetSystemDateAndTime();
  await testGetDeviceInformation();
  await testGetScopes();
  await testGetServices();
  await testGetCapabilities();

  const profileToken = await testGetProfiles(username, password);
  if (profileToken) {
    await testGetStreamUri(profileToken, username, password);
  }

  await testCreatePullPointSubscription(username, password);

  printSection("DONE");
  console.log("");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
