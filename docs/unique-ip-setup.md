# Unique IP / MAC Setup for UniFi Protect

UniFi Protect identifies third-party ONVIF cameras by **MAC address**. When multiple virtual cameras share the same host MAC, UniFi sees them as a single device. This guide explains how to configure unique IPs and MACs for each camera so UniFi Protect adopts them as separate devices.

## Prerequisites

- Scrypted running in Docker with the **Rebroadcast** plugin installed
- Docker socket mounted in the Scrypted container (`/var/run/docker.sock`)
- A network bridge interface available for macvlan (e.g. `br0`)

## How It Works

The plugin creates a **Docker macvlan network** and spawns a lightweight **proxy container** (`alpine/socat`) for each camera. Each proxy has:

- A **unique IP address** on your LAN
- A **unique MAC address** (deterministic, based on device ID)
- TCP proxies for **ONVIF** (port 8000) and **RTSP** (port 554+) traffic

```
UniFi Protect                Docker macvlan proxy              Scrypted container
(your LAN)                   (unique IP + MAC)                 (internal IP)
     │                              │                                │
     │── ONVIF (port 8000) ───────▶│── TCP proxy ─────────────────▶│  ONVIF server
     │── RTSP  (port 554)  ───────▶│── TCP proxy ─────────────────▶│  RTSP rebroadcast
```

## Step 1: Mount Docker Socket

The plugin needs access to Docker to create proxy containers. Add this path mapping to your Scrypted container:

| Container Path | Host Path |
|---|---|
| `/var/run/docker.sock` | `/var/run/docker.sock` |

### Unraid
Edit the Scrypted container → Add Path → Container: `/var/run/docker.sock`, Host: `/var/run/docker.sock`

### Docker Compose
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

### Docker CLI
```bash
docker run ... -v /var/run/docker.sock:/var/run/docker.sock ...
```

## Step 2: Configure Plugin Settings

Open the ONVIF Rebroadcast plugin settings in Scrypted and configure the **IP Allocation** section:

| Setting | Description | Example |
|---|---|---|
| **Auto-assign unique IPs** | Enable automatic proxy container creation | `✓` (checked) |
| **IP range start** | First IP to assign (must be on the same subnet as your NVR) | `192.168.1.240` |
| **Network interface** | Parent interface for the macvlan Docker network | `br0` |
| **Subnet prefix length** | CIDR prefix matching your network | `23` or `24` |
| **Gateway** | Your network's default gateway | `192.168.1.1` |

### Choosing the Right IP Range

- Pick IPs **outside your DHCP pool** to avoid conflicts
- IPs must be on the **same subnet** as your UniFi controller
- Example: if your router's DHCP range is `192.168.1.2–200`, use `192.168.1.240` as the start
- Each camera gets the next sequential IP (`.240`, `.241`, `.242`, etc.)

### Choosing the Network Interface

| Platform | Interface | Notes |
|---|---|---|
| Unraid (ipvlan on br0.2) | `br0` | Use the main bridge, not the VLAN interface |
| Docker (bridge network) | `eth0` or `br0` | Check `ip link show` on your host |
| Synology | `ovs_eth0` or `bond0` | Depends on your network config |

> **Important (Unraid):** If your Scrypted container uses `Custom: br0.2` (ipvlan), set the network interface to `br0` — not `br0.2`. ipvlan networks share MAC addresses and won't work with UniFi. The plugin creates a separate macvlan network on `br0` for the proxy containers.

## Step 3: Reload the Plugin

After saving the settings, reload the ONVIF Rebroadcast plugin. Check the logs for:

```
Docker socket found — proxy container mode available
Created macvlan network on br0 (192.168.0.0/23)
Proxy container onvif-proxy-133: IP=192.168.1.241 MAC=02:cc:30:40:1c:d7 → 192.168.4.40:18000
```

Each camera should show its assigned IP and MAC.

## Step 4: Add Cameras in UniFi Protect

1. In UniFi Protect: **Settings → Cameras → Add Camera → ONVIF**
2. Enter each camera's assigned IP with port **8000**
3. Enter the ONVIF username and password (configured in the plugin's Authentication settings)
4. Each camera will be recognized as a separate device

## Step 5: Verify

You can verify the proxy containers are running:

```bash
docker ps | grep onvif
```

Test connectivity from any device on your network:

```bash
curl -s http://192.168.1.240:8000/onvif/device_service -d '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>'
```

## Troubleshooting

### "Docker socket not found"
Mount `/var/run/docker.sock` in the Scrypted container. See Step 1.

### "Failed to create macvlan network: Pool overlaps"
A Docker network already exists on the same subnet. The plugin will try to find and reuse existing macvlan networks automatically. If it fails, check `docker network ls` and remove stale `onvif_cameras` networks.

### Proxy containers not reachable
- Ensure the IP range is on the **same subnet** as the device trying to connect
- Check that the **gateway** is correct
- Verify the **network interface** exists on the Docker host (`ip link show`)

### UniFi still shows one camera
- Confirm proxy containers have unique MACs: `docker inspect onvif-proxy-XXX | grep MacAddress`
- Remove all existing cameras from UniFi Protect before re-adding
- The macvlan network must be `macvlan` driver (not `ipvlan`) — check with `docker network inspect onvif_cameras | grep Driver`

### Cameras added but no video
- Check that the Rebroadcast plugin is installed and the camera has RTSP streams configured
- The RTSP stream URLs are automatically proxied through port 554+ on each camera's IP
- Verify the RTSP URL works: connect to `rtsp://camera-ip:554/stream-path` with VLC

### IP assignments change after restart
- IP assignments are persistent — stored in Scrypted's plugin storage
- Once a camera gets an index, it keeps the same IP forever
- New cameras get the next available index

## Architecture Details

### Proxy Container Lifecycle

- Containers are named `onvif-proxy-{deviceId}`
- Restart policy: `unless-stopped` (auto-restart on crash)
- Image: `alpine/socat` (pulled automatically on first use, ~5MB)
- Each container runs multiple `socat` instances:
  - Port 8000 → Scrypted ONVIF server (internal port)
  - Port 554 → Scrypted RTSP rebroadcast stream 1
  - Port 555 → stream 2, etc.

### MAC Address Generation

Each camera gets a deterministic MAC address derived from its Scrypted device ID:
- Format: `02:xx:xx:xx:xx:xx` (locally administered, unicast)
- Same device ID always produces the same MAC
- Survives plugin restarts and container recreation

### Network Topology

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Host                          │
│                                                         │
│  ┌──────────────┐     ┌──────────────────────────────┐ │
│  │  Scrypted     │     │  onvif_cameras network       │ │
│  │  Container    │     │  (macvlan on br0)             │ │
│  │              │     │                              │ │
│  │  ONVIF:18000 │◄────│  Proxy 1: 192.168.1.240:8000 │ │
│  │  ONVIF:18001 │◄────│  Proxy 2: 192.168.1.241:8000 │ │
│  │  RTSP:42917  │◄────│  Proxy 1: 192.168.1.240:554  │ │
│  │  RTSP:43218  │◄────│  Proxy 2: 192.168.1.241:554  │ │
│  │              │     │                              │ │
│  │  br0.2 ipvlan│     │  Each proxy has unique MAC   │ │
│  │  192.168.4.40│     │                              │ │
│  └──────────────┘     └──────────────────────────────┘ │
│                                                         │
│  br0 ──── Physical NIC ──── Switch ──── UniFi Protect  │
└─────────────────────────────────────────────────────────┘
```
