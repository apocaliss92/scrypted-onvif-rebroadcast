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

- Scrypted running in Docker with the **Rebroadcast plugin** installed
- Docker socket mounted in the Scrypted container (`/var/run/docker.sock`)
- A network interface available for macvlan (e.g. `br0`)

### Docker Socket

The plugin needs access to the Docker socket to create proxy containers. Add this path mapping to your Scrypted container:

| Container Path | Host Path |
|---|---|
| `/var/run/docker.sock` | `/var/run/docker.sock` |

### Plugin Settings

| Setting | Description | Example |
|---|---|---|
| **Username / Password** | ONVIF authentication credentials | `admin` / `password` |
| **Auto-assign unique IPs** | Enable automatic proxy container creation | `true` |
| **IP range start** | First IP to assign to cameras | `192.168.1.240` |
| **Network interface** | Parent interface for the macvlan Docker network | `br0` |
| **Subnet prefix length** | CIDR prefix for the macvlan network | `23` |
| **Gateway** | Default gateway for the macvlan network | `192.168.1.1` |

### IP Range Selection

Choose IPs **outside your DHCP pool** on the same subnet as your UniFi controller. For example, if your router assigns `192.168.1.2-200` via DHCP, use `192.168.1.240` as the start.

### How It Works

```
UniFi Protect                    Docker macvlan proxy              Scrypted container
(192.168.1.x)                    (192.168.1.240, unique MAC)       (192.168.4.40)
     |                                  |                                |
     |--- ONVIF (port 8000) ---------->|--- TCP proxy (port 18000) --->|  ONVIF server
     |--- RTSP  (port 554)  ---------->|--- TCP proxy (port 42917) -->|  RTSP rebroadcast
```

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
