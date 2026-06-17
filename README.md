# Scrypted ONVIF Rebroadcast

Creates virtual ONVIF-compliant camera devices from Scrypted's RTSP rebroadcast streams, enabling third-party NVRs like **UniFi Protect** to adopt cameras that aren't natively supported.

## Features

- Wraps Scrypted RTSP rebroadcast streams in ONVIF Profile S endpoints
- **Unique IP & MAC per camera** via Docker macvlan proxy containers (required for UniFi Protect)
- Automatic Docker network and proxy container management
- WS-Discovery for ONVIF auto-detection
- PTZ, motion events, and object detection forwarded via ONVIF
- WS-Security and HTTP Basic authentication
- Persistent IP assignments across restarts

## UniFi Protect Setup

UniFi Protect identifies third-party cameras by MAC address. To add multiple cameras, each needs a unique IP and MAC on the network. This plugin handles this automatically using Docker macvlan proxy containers.

### Prerequisites

- The **Rebroadcast plugin** installed in Scrypted
- Docker installed and the Docker socket accessible at `/var/run/docker.sock`
- A parent network interface available for macvlan (e.g. `eth0`, `ens3`, `br0`)

#### Scrypted in Docker (bridge networking - recommended)

Mount the Docker socket so the plugin can create and manage proxy containers:

```yaml
# docker-compose.yml
services:
  scrypted:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Or with `docker run`:
```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock ...
```

With bridge networking, Scrypted gets a Docker bridge IP (e.g. `172.17.0.2`) in a different subnet from the macvlan cameras. The plugin detects that bridge network and connects each proxy container to it, so ONVIF and RTSP traffic can reach Scrypted without a host-side shim.

#### Scrypted in Docker with `--network=host`, or native install

When Scrypted shares the host network stack (host networking or bare-metal), it gets the same LAN IP as the host (e.g. `192.168.1.50`). Macvlan containers cannot reach that IP directly due to kernel macvlan-to-host isolation.

The plugin detects this automatically when Scrypted's IP is in the same subnet as the macvlan network and tries to create a `macvlan-shim0` interface on the host through a temporary privileged helper container. If your Docker setup does not allow privileged helper containers, create the shim manually with root or `CAP_NET_ADMIN`.

**Docker with host networking:**
```yaml
cap_add:
  - NET_ADMIN
network_mode: host
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

**Native install:** Docker must still be installed and `/var/run/docker.sock` must be accessible so the plugin can create proxy containers. Manual shim creation requires root or `CAP_NET_ADMIN` on the host.

If automatic shim creation fails, check the plugin logs and run manually on the host:
```bash
ip link add macvlan-shim0 link <parent-iface> type macvlan mode bridge
ip addr add <shim-ip>/<prefix> dev macvlan-shim0
ip link set macvlan-shim0 up
```

Use the **Macvlan shim IP** plugin setting to control which IP is assigned. Leave it empty unless the auto-selected address conflicts with another device.

### Plugin Settings

| Setting | Description | Example |
|---|---|---|
| **Username / Password** | ONVIF authentication credentials | `admin` / `password` |
| **Auto-assign unique IPs** | Enable automatic proxy container creation | `true` |
| **IP range start** | First IP to assign to cameras | `192.168.1.240` |
| **Network interface** | Parent interface for the macvlan Docker network | `eth0` |
| **Subnet prefix length** | CIDR prefix for the macvlan network | `24` |
| **Gateway** | Default gateway for the macvlan network | `192.168.1.1` |
| **Macvlan shim IP** | *(Native / host networking only)* IP for the host-side macvlan shim interface. Must be in the same subnet as the IP range and not in use. Leave empty to auto-assign (subnet base + 2). Ignored in Docker bridge mode. | `192.168.1.2` |

### IP Range Selection

Choose IPs **outside your DHCP pool** on the same subnet as your UniFi controller. For example, if your router assigns `192.168.1.2-200` via DHCP, use `192.168.1.240` as the start.

### How It Works

**Scrypted in Docker (bridge networking):**
```
UniFi Protect          macvlan proxy container       Scrypted container
(192.168.1.x)          (192.168.1.240, unique MAC)   (172.17.0.2 / bridge)
     |                          |                            |
     |-- ONVIF (port 8000) --->|-- TCP:18000 over bridge ->|  ONVIF server
     |-- RTSP  (port 554)  --->|-- TCP:42917 over bridge ->|  RTSP rebroadcast
```

**Scrypted on bare metal / VM:**
```
UniFi Protect          macvlan proxy container       macvlan-shim0       Scrypted (native)
(192.168.1.x)          (192.168.1.240, unique MAC)   (192.168.1.2)       (192.168.1.50)
     |                          |                          |                    |
     |-- ONVIF (port 8000) --->|-- TCP:18000 ----------->|-- loopback ------->|  ONVIF server
     |-- RTSP  (port 554)  --->|-- TCP:42917 ----------->|-- loopback ------->|  RTSP rebroadcast
```

The macvlan shim (`macvlan-shim0`) is a host-side macvlan interface that breaks kernel-level macvlan-to-host isolation, allowing proxy containers to reach Scrypted on the same machine.

Each camera gets its own proxy container with:
- A unique IP address on your LAN
- A unique MAC address (deterministic, based on device ID)
- TCP proxies for both ONVIF (port 8000) and RTSP (port 554+) traffic

### Adding Cameras in UniFi Protect

1. Install and configure the plugin in Scrypted
2. Enable "Auto-assign unique IPs" and configure the IP range
3. The plugin automatically creates proxy containers (visible in Docker)
4. In UniFi Protect: **Settings > Cameras > Add Camera > ONVIF**
5. Enter each camera's assigned IP with port `8000`
6. Enter the ONVIF username/password you configured

### Audio in UniFi Protect

UniFi Protect audio depends on the RTSP stream codec that Scrypted Rebroadcast serves. This plugin wraps those RTSP URLs in ONVIF and proxies them; it does not transcode audio itself.

For third-party camera audio in Protect:

1. In Scrypted's Rebroadcast settings for the camera, choose the stream mode that actually exposes working audio in Protect. Some cameras work better with default rebroadcast audio than Improved Compatibility Mode.
2. Reload or refresh this plugin so the updated rebroadcast stream is discovered.
3. On the camera's ONVIF Rebroadcast mixin settings, set **Streams to expose via ONVIF** to the working main/sub streams.
4. Remove and re-add the camera in UniFi Protect if it was already adopted; Protect caches stream/profile metadata.

The plugin logs each discovered stream's audio codec so you can compare modes and select the stream that works best with Protect.

### Unraid Notes

- If your Scrypted container uses `Custom: br0.2` (ipvlan), create the macvlan network on `br0` instead to get unique MACs
- The plugin creates a Docker network called `onvif_cameras` for the proxy containers
- Proxy containers are named `onvif-proxy-{deviceId}` and auto-restart
- The `alpine/socat` image is pulled automatically on first use

## Architecture

The plugin is a Scrypted **MixinProvider** that attaches to Camera and Doorbell devices:

1. **Stream Discovery** - Finds RTSP rebroadcast URLs from the Rebroadcast plugin
2. **ONVIF Server** - Creates an HTTP server per camera serving ONVIF SOAP endpoints
3. **Proxy Containers** - Spawns Docker containers with macvlan networking for unique IPs/MACs
4. **Event Forwarding** - Scrypted motion/detection events are forwarded via ONVIF pull-point subscriptions

## Development

```bash
npm install
npm run build
npx scrypted login <scrypted-ip>
npm run scrypted-deploy <scrypted-ip>
```

---

[Buy me a coffee!](https://buymeacoffee.com/apocaliss92)

[For requests and bugs](https://github.com/apocaliss92/scrypted-onvif-rebroadcast/issues)
