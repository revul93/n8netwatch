# n8watch — Network Night Watch

**n8watch** is a self-hosted, real-time IP and network host monitoring system. It continuously pings your targets, records latency, jitter, and packet loss in a local SQLite database, and exposes everything through a clean React dashboard with WebSocket live updates, configurable email alerts, and CSV/PDF export.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
  - [Installing Node.js 24 on Linux](#installing-nodejs-24-on-linux)
- [Setup and Installation](#setup-and-installation)
  - [Linux / macOS — One-line Install](#linux--macos--one-line-install)
  - [Linux / macOS — Manual Install](#linux--macos--manual-install)
  - [Windows](#windows)
- [Configuration](#configuration)
  - [General Settings](#general-settings)
  - [Interfaces](#interfaces)
  - [Targets](#targets)
  - [System-Defined vs User-Defined Targets](#system-defined-vs-user-defined-targets)
  - [Server](#server)
  - [Alerts and Email Notifications](#alerts-and-email-notifications)
  - [Alert Rule Conditions](#alert-rule-conditions)
  - [Internet Speed Tests](#internet-speed-tests)
- [Running the Application](#running-the-application)
  - [Direct Start](#direct-start)
  - [Production with PM2](#production-with-pm2)
- [Utility Scripts](#utility-scripts)
  - [Flushing Database Data](#flushing-database-data)
  - [Nuking the Database](#nuking-the-database)
- [Optional: Backup and Restore](#optional-backup-and-restore)
- [Web Dashboard](#web-dashboard)
- [API Reference](#api-reference)
- [Optional: Remote Desktop Setup](#optional-remote-desktop-setup-linux)
- [Optional: Firewall Configuration](#optional-firewall-configuration)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## Features

- 📡 **Real-time ICMP Monitoring** — Pings multiple targets at a configurable interval and records min/avg/max latency, jitter, and packet loss per cycle.
- 📊 **Web Dashboard** — React-based UI displaying live metrics, sparkline charts, uptime percentages, and status indicators for every monitored host.
- 📜 **Historical Data** — All ping results are stored in a local SQLite database. Configurable retention period (default 90 days).
- 🚨 **Flexible Alert Engine** — Write conditions using variables such as `avg_latency`, `packet_loss`, or `jitter`. Apply rules globally or restrict them to specific targets.
- 📧 **Email Notifications** — Sends HTML-formatted SMTP emails when alert conditions fire, with per-rule cooldowns to suppress duplicate notifications.
- 🔄 **Live Config Reload** — Edit `config.yaml` while the app is running; target changes, interval tweaks, and rule updates are applied within seconds — no restart required.
- 🔌 **WebSocket Push** — Fresh metrics are broadcast to all connected browser tabs the instant each ping cycle completes.
- ⚡ **Internet Speed Testing** — Optional scheduled download/upload checks using `speedtest-cli`, `fast-cli`, or both tools (averaged), with live chart updates.
- 📤 **CSV Export** — Download raw ping data for any time range directly from the History page.
- 🌐 **Multi-Interface Support** — Declare named network interfaces in `config.yaml` and assign a specific outgoing interface to any target. A drop-down in the dashboard lets users choose an interface when adding temporary targets.
- 🗄️ **Lightweight Persistence** — Uses SQLite via `better-sqlite3`; no external database server required.
- 🔒 **HTTPS Support** — Optional TLS configuration in `config.yaml` for serving the dashboard over HTTPS.
- 📋 **PDF Report** — A printable system guide is available under `docs/`.
- 💾 **Backup & Restore** — Optional shell script to archive and restore the database and configuration.

---

## Prerequisites

| Requirement | Version              | Notes                                              |
|-------------|----------------------|----------------------------------------------------|
| Node.js     | **24 LTS** (recommended) | v18+ minimum; v24 LTS strongly recommended     |
| npm         | Bundled with Node.js | —                                                  |
| `ping`      | System binary        | Pre-installed on Linux, macOS, and Windows         |
| `speedtest-cli` | Optional CLI tool | Used for Internet speed tests (download/upload)    |
| `fast-cli` (`fast`) | Optional CLI tool | Used for Internet speed tests (download/upload)    |

> **Linux note:** If `ping` is not available, install it with:
> ```bash
> sudo apt install iputils-ping
> ```

### Installing Node.js 24 on Linux

The recommended way to install and manage Node.js on Linux is through **nvm** (Node Version Manager):

```bash
# 1. Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 2. Reload your shell profile
source ~/.bashrc

# 3. Install Node.js 24
nvm install 24

# 4. Use Node.js 24
nvm use 24
```

> The setup scripts (`setup.sh` / `setup.ps1`) will automatically install **Node.js v24 LTS** if Node.js is not already detected on your system.

---

## Setup and Installation

---

### Linux / macOS — One-line Install

Clone the repository and run the interactive setup in a single command.

**Using curl:**

```bash
curl -fsSL https://raw.githubusercontent.com/revul93/n8watch/main/install.sh | bash
```

**Using wget:**

```bash
wget -qO- https://raw.githubusercontent.com/revul93/n8watch/main/install.sh | bash
```

This clones the repository into an `n8watch/` directory in the current working directory and launches the interactive `setup.sh` automatically.

> **Security note:** Review the script before piping it to bash:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/revul93/n8watch/main/install.sh
> ```

The setup script will:

1. Verify (and optionally install) Node.js v24 and `ping`.
2. Install optional speedtest tools (`speedtest-cli` and `fast-cli`) used by the Internet Speed widget.
3. Install backend dependencies (`npm install --omit=dev`).
4. Install and build the React frontend (`cd client && npm install && npm run build`).
5. Detect your network interfaces via `ip addr` (Linux) or `ifconfig` (macOS) and write them into `config.yaml`.
6. Prompt for an admin dashboard password.
7. Offer to start the app under PM2 and configure auto-start on boot.

---

### Linux / macOS — Manual Install

```bash
# 1. Clone the repository
git clone https://github.com/revul93/n8watch.git
cd n8watch

# 2. Install backend dependencies
npm install --omit=dev

# 3. Install and build the React frontend
cd client && npm install && npm run build && cd ..

# 4. Copy the example configuration
cp config.example.yaml config.yaml

# 5. Edit config.yaml with your targets and SMTP settings (see Configuration below)
```

---

### Windows

#### Prerequisites (Windows)

| Requirement  | Notes                                                                                                  |
|--------------|--------------------------------------------------------------------------------------------------------|
| Node.js 24   | [nodejs.org](https://nodejs.org) — Windows Installer (.msi); v18+ minimum, v24 recommended            |
| Git          | [git-scm.com](https://git-scm.com/download/win)                                                        |
| Build Tools  | Run `npm install -g windows-build-tools` **as Administrator** (required to compile native modules)     |

#### One-line install (PowerShell)

Open **PowerShell** and run:

```powershell
Invoke-Expression (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/revul93/n8watch/main/install.ps1" -UseBasicParsing).Content
```

#### Manual install (Windows)

```powershell
git clone https://github.com/revul93/n8watch.git
cd n8watch
powershell -ExecutionPolicy Bypass -File setup.ps1
```

#### Starting on Windows

```cmd
REM Option A — CMD (double-click or command prompt)
start.cmd

REM Option B — Node.js directly
node server\index.js
```

```powershell
# Option C — PM2 (recommended for production)
npm run pm2:start
```

---

## Configuration

All settings live in `config.yaml` at the project root. The file is watched at runtime — save your edits and they are applied within a second without restarting the server.

Copy the annotated example to get started:

```bash
cp config.example.yaml config.yaml
```

---

### General Settings

```yaml
general:
  ping_interval: 30          # Seconds between ping cycles (1–59)
  ping_count: 5              # ICMP packets sent per cycle
  ping_timeout: 5            # Per-packet timeout in seconds
  data_retention_days: 90    # How long to keep historical ping results
  max_user_target_lifetime_days: 7  # Auto-expiry for user-added targets
```

---

### Interfaces

The optional `interfaces` section lists the network interfaces on the monitoring host. The dashboard uses this list to let users choose an outgoing interface when adding targets.

| Field   | Required | Description                                                  |
|---------|----------|--------------------------------------------------------------|
| `name`  | yes      | OS interface name used by `ping -I` (e.g. `eth0`, `ens3`)   |
| `alias` | no       | Human-readable label shown in the dashboard                  |
| `ipv4`  | no       | IPv4 address bound to this interface                         |

```yaml
interfaces:
  - name: "eth0"
    alias: "Primary LAN"
    ipv4: "192.168.1.100"
  - name: "eth1"
    alias: "Management NIC"
    ipv4: "10.0.0.1"
```

> Run `ip link` (Linux) or `ifconfig` (macOS) to list your interface names.
> The `setup.sh` script auto-detects interfaces and populates this section for you.

---

### Targets

```yaml
targets:
  - name: "Google DNS"       # Display name shown in the dashboard
    ip: "8.8.8.8"            # IP address or resolvable hostname
    group: "DNS Servers"     # Optional group label for filtering
    interface: "eth0"        # Optional: outgoing interface (must match an entry in interfaces)

  - name: "Core Router"
    ip: "192.168.1.1"
    group: "Local Network"
    # interface: "eth1"      # Omit to use the default system interface
```

---

### System-Defined vs User-Defined Targets

n8watch supports two kinds of monitored targets:

#### System-Defined Targets (`config.yaml`)

Targets listed under `targets:` in `config.yaml` are **system-defined**. They are:

- Loaded automatically at startup.
- Kept in sync on every live config reload — new entries are added and removed entries are deleted.
- **Persistent** — they remain in the database as long as they appear in `config.yaml`.
- Monitored continuously on every ping cycle.
- Subject to all configured alert rules.

#### User-Defined Targets (dashboard / API)

Users can add **temporary targets** directly from the dashboard — no config edit required. These are:

- Created via the **Add Target** panel or `POST /api/targets/user-targets`.
- **Temporary** — automatically removed after `max_user_target_lifetime_days` (default 7 days).
- Not written back to `config.yaml`; they do not survive a database nuke.
- Removable at any time from the dashboard or via `DELETE /api/targets/user-targets/:id`.
- Subject to alert rules, just like system-defined targets.

> **Tip:** Use system-defined targets for critical, permanent hosts and user-defined targets for quick ad-hoc checks (e.g. troubleshooting a transient connectivity issue).

**Comparison:**

| Feature                           | System-Defined | User-Defined   |
|-----------------------------------|----------------|----------------|
| Defined in `config.yaml`          | ✅ Yes          | ❌ No           |
| Persists across restarts          | ✅ Yes          | ⚠️ Temporary    |
| Live-reloaded with config         | ✅ Yes          | ❌ No           |
| Added via dashboard / API         | ❌ No           | ✅ Yes          |
| Subject to alert rules            | ✅ Yes          | ✅ Yes          |
| Manually removable from dashboard | ❌ No           | ✅ Yes          |

---

### Server

```yaml
server:
  port: 3000          # HTTP(S) port the server listens on
  host: "0.0.0.0"     # Bind address (0.0.0.0 = all interfaces)

  # Optional TLS — uncomment to enable HTTPS
  # ssl:
  #   enabled: true
  #   cert: "/etc/letsencrypt/live/yourdomain.com/fullchain.pem"
  #   key:  "/etc/letsencrypt/live/yourdomain.com/privkey.pem"
```

---

### Alerts and Email Notifications

```yaml
alerts:
  email_notifications: true   # Set to false to disable all email alerts

  smtp:
    host: "smtp.gmail.com"
    port: 587
    secure: false             # true for port 465, false for STARTTLS (587)
    user: "you@gmail.com"
    pass: "app-password"      # Use an app-specific password
    from: "n8watch <monitor@yourdomain.com>"
    to:
      - "admin@yourdomain.com"

  rules:
    - name: "Host Down"
      condition: "packet_loss == 100"
      severity: "critical"    # critical | warning
      cooldown: 300           # Minimum seconds between repeated alerts for the same target
      trigger_after: 3        # Only alert after the condition holds for 3 consecutive cycles (default 1)
      # targets: []           # Omit or leave empty to apply to all targets

    - name: "High Packet Loss"
      condition: "packet_loss > 20"
      severity: "warning"
      cooldown: 600
      targets:                # Restrict to specific targets by name, IP, or numeric ID
        - "Google DNS"
        - "Cloudflare DNS"

    - name: "High Latency"
      condition: "avg_latency > 200"
      severity: "warning"
      cooldown: 600

    - name: "High Jitter"
      condition: "jitter > 50"
      severity: "warning"
      cooldown: 600
```

---

### Alert Rule Conditions

Conditions are evaluated as JavaScript expressions. Available variables:

| Variable           | Type        | Description                        |
|--------------------|-------------|------------------------------------|
| `is_alive`         | `0` or `1`  | Whether the host responded         |
| `packet_loss`      | `0`–`100`   | Percentage of lost packets         |
| `avg_latency`      | number (ms) | Average round-trip time            |
| `min_latency`      | number (ms) | Minimum round-trip time            |
| `max_latency`      | number (ms) | Maximum round-trip time            |
| `jitter`           | number (ms) | `(max_latency - min_latency) / 2`  |
| `packets_sent`     | integer     | Total packets sent per cycle       |
| `packets_received` | integer     | Total packets received per cycle   |

**Examples:**

```yaml
condition: "packet_loss == 100"   # Host is completely unreachable
condition: "packet_loss > 20"     # More than 20% packet loss
condition: "avg_latency > 200"    # Average latency exceeds 200 ms
condition: "jitter > 50"          # Jitter exceeds 50 ms
condition: "is_alive == 0"        # Host not responding
```

---

### Alert Trigger Threshold (`trigger_after`)

By default a rule fires the moment its condition is true for a single ping
cycle. To avoid paging on a brief, self-healing blip, set `trigger_after` on a
rule: the condition must hold for that many **consecutive** ping cycles before
the alert fires. This is configurable per rule from the **Settings → Alert
Rules** dashboard (the "Trigger after" field) or directly in `config.yaml`.

```yaml
rules:
  - name: "Host Down"
    condition: "packet_loss == 100"
    severity: "critical"
    cooldown: 1800
    trigger_after: 3      # Alert only after 3 consecutive fully-lost cycles
```

- **Unit:** consecutive ping cycles (each cycle sends `general.ping_count`
  pings), not individual packets. With `ping_interval: 8`, `trigger_after: 3`
  means roughly 24 seconds of continuous failure before alerting.
- **Reset:** any cycle where the condition is *false* resets the counter, so
  the threshold always counts an unbroken run.
- **Default:** `1` — omit the field for the original "alert immediately"
  behaviour. `occurrences` is accepted as an alias for `trigger_after`.
- **Interaction with `cooldown`:** `trigger_after` gates the *first* alert of an
  episode; `cooldown` still governs how often repeat alerts may be sent
  afterwards.

---

### Internet Speed Tests

n8watch can run periodic internet speed tests and show results on the dashboard.

```yaml
speedtest:
  enabled: false        # set true to enable scheduled tests
  interval: 3600        # seconds between tests (minimum 60)
  interface: ""         # optional outgoing interface name (used by speedtest-cli)
  tool: "speedtest"     # "speedtest", "fast", or "both" (average)
  show: "both"          # "download", "upload", or "both"
```

Notes:
- `speedtest-cli` supports binding to a source IP (derived from the selected interface).
- `fast-cli` does not support source-interface binding.
- When `tool: "both"` is selected, n8watch runs both CLIs and averages successful results.

---

## Running the Application

### Direct Start

```bash
# Start the server
npm start

# Or run Node.js directly
node server/index.js
```

Open `http://localhost:3000` in your browser (or the host/port you set in `config.yaml`).

To run the frontend in hot-reload mode during development:

```bash
cd client
npm run dev   # Vite dev server on http://localhost:5173
              # API requests are proxied to the backend on :3000
```

---

### Production with PM2

[PM2](https://pm2.keymetrics.io/) is the recommended process manager for production. It handles automatic restarts on crash, log rotation, and system startup integration.

```bash
# Install PM2 globally (one-time)
npm install -g pm2

# Start n8watch
npm run pm2:start

# View live logs
npm run pm2:logs

# Check process status
npm run pm2:status

# Graceful reload (zero-downtime)
npm run pm2:reload

# Hard restart
npm run pm2:restart

# Stop
npm run pm2:stop
```

**Enable auto-start on system boot:**

```bash
npm run pm2:startup   # Generates and runs the systemd/launchd hook
npm run pm2:save      # Saves the current process list
```

Application logs are written to `logs/out.log` (stdout) and `logs/error.log` (stderr).

---

## Utility Scripts

### Flushing Database Data

Use the flush script to clear stored records from the database **without** deleting the database file.

> Stop the application before flushing to avoid conflicts.

```bash
# Flush ping results only (default)
npm run db:flush

# Flush alert records only
node scripts/flush-data.js --alerts

# Flush ping results and alerts
node scripts/flush-data.js --ping-results --alerts

# Flush everything — ping results, alerts, and all targets
npm run db:flush:all

# Skip the confirmation prompt (useful in scripts)
node scripts/flush-data.js --all --yes
```

| Flag                         | What is deleted                       |
|------------------------------|---------------------------------------|
| _(none)_ or `--ping-results` | All rows in `ping_results`            |
| `--alerts`                   | All alert records                     |
| `--ping-results --alerts`    | Ping results **and** alert records    |
| `--all`                      | Ping results, alerts, and all targets |
| `--yes`                      | Suppresses the confirmation prompt    |

After flushing, restart normally — system-defined targets from `config.yaml` will be re-created on the next ping cycle.

---

### Nuking the Database

The nuke script **completely wipes** the database and recreates an empty schema. Unlike flush (which deletes rows), nuke deletes the database file itself — including WAL and SHM sidecar files — and starts from scratch. Auto-increment counters are reset.

> Stop the application before nuking to avoid conflicts.

```bash
# Interactive — type YES to confirm
npm run db:nuke

# Non-interactive (CI / scripts)
node scripts/nuke-db.js --yes
```

After nuking, start the application normally. Targets from `config.yaml` will be loaded on the next ping cycle.

---

## Web Dashboard

Once running, open `http://<host>:3000` in your browser.

| Page      | URL        | Description                                                                 |
|-----------|------------|-----------------------------------------------------------------------------|
| Dashboard | `/`        | Live grid of all monitored hosts — status, latency, jitter, uptime          |
| History   | `/history` | Paginated ping history with date filters and CSV export                     |
| Alerts    | `/alerts`  | Active and historical alerts with acknowledgement; view configured rules    |

---

## API Reference

All endpoints are prefixed with `/api` and return JSON.

### Targets

| Method   | Endpoint                        | Description                                |
|----------|---------------------------------|--------------------------------------------|
| `GET`    | `/api/targets`                  | List all targets with their latest metrics |
| `GET`    | `/api/targets/:id`              | Get details for a specific target          |
| `GET`    | `/api/targets/:id/metrics`      | Get aggregated metrics for a target        |
| `GET`    | `/api/targets/:id/ping-results` | Get ping history for a target              |
| `POST`   | `/api/targets/user-targets`     | Add a temporary user-defined target        |
| `DELETE` | `/api/targets/user-targets/:id` | Remove a temporary user-defined target     |

### Interfaces

| Method | Endpoint          | Description                                           |
|--------|-------------------|-------------------------------------------------------|
| `GET`  | `/api/interfaces` | List network interfaces defined in `config.yaml`      |

### Ping Results

| Method | Endpoint            | Description                                  |
|--------|---------------------|----------------------------------------------|
| `GET`  | `/api/ping-results` | Get historical results (supports filtering)  |

### Alerts

| Method | Endpoint                      | Description                   |
|--------|-------------------------------|-------------------------------|
| `GET`  | `/api/alerts`                 | List alert events             |
| `POST` | `/api/alerts/:id/acknowledge` | Acknowledge a specific alert  |

### Dashboard & Export

| Method | Endpoint         | Description                                                          |
|--------|------------------|----------------------------------------------------------------------|
| `GET`  | `/api/dashboard` | Summary statistics (overall uptime, average latency, active alerts)  |
| `GET`  | `/api/export`    | Export metrics to CSV                                                |

### Speedtest

| Method | Endpoint                 | Description                                      |
|--------|--------------------------|--------------------------------------------------|
| `GET`  | `/api/speedtest/results` | List historical speed test results               |
| `GET`  | `/api/speedtest/latest`  | Get the most recent speed test result            |
| `GET`  | `/api/speedtest/tools`   | Check if `speedtest-cli` and `fast` are present  |
| `POST` | `/api/admin/speedtest/run` | Trigger an immediate speed test (admin auth)   |

### WebSocket

Connect to `ws://<host>:3000` (use `wss://` behind a TLS-terminating proxy) to receive real-time push events:

- **`ping_result`** — Emitted after each ping cycle with fresh metrics for all targets.
- **`alert`** — Emitted when an alert rule fires.
- **`speedtest_result`** — Emitted when a speed test run completes.
- **`config_reloaded`** — Emitted when `config.yaml` is reloaded.

---

## Optional: Remote Desktop Setup (Linux)

This guide shows how to run n8watch on a headless Linux server, display the dashboard in a full-screen browser, and access it remotely via VNC. This is useful for a dedicated monitoring workstation or a wall-mounted display.

### 1. Install a Desktop Environment

```bash
sudo apt update
sudo apt install xfce4 xfce4-goodies lightdm -y
```

### 2. Configure Auto-Login

Edit the LightDM configuration to enable automatic login to the XFCE desktop:

```bash
sudo nano /etc/lightdm/lightdm.conf
```

Add the following block (replace `administrator` with your username):

```ini
[Seat:*]
xserver-command=X -core
autologin-user=administrator
autologin-session=xfce
```

### 3. Install Chromium

```bash
sudo apt install chromium-browser -y
```

### 4. Auto-Launch the Dashboard in Kiosk Mode

Create an autostart entry so Chromium opens the n8watch dashboard on login:

```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/browser.desktop
```

Paste the following (replace `YOUR_PORT` with your configured port, e.g. `3000`):

```ini
[Desktop Entry]
Type=Application
Exec=chromium-browser --kiosk http://localhost:YOUR_PORT
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Name=Monitoring
```

### 5. Install and Configure VNC for Remote Access

Install `x11vnc` to mirror the physical desktop over the network:

```bash
sudo apt install x11vnc -y

# Set a VNC password
x11vnc -storepasswd
```

Create a systemd service so VNC starts automatically with the display manager:

```bash
sudo nano /etc/systemd/system/x11vnc.service
```

Paste (replace `administrator` with your username and update the password file path if needed):

```ini
[Unit]
Description=Start x11vnc
After=display-manager.service

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -auth guess -forever -loop -noxdamage -repeat \
  -rfbauth /home/administrator/.vnc/passwd -rfbport 5900 -shared
User=administrator

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable x11vnc
sudo systemctl start x11vnc
```

Connect from any VNC client (e.g. RealVNC, TigerVNC) to `<server-ip>:5900`.

### 6. Prevent Screen Sleep

To keep the display on at all times, disable power management in the XFCE Power Manager:

```
xfce4-power-manager-settings
→ Display tab → turn all sleep/blank timers OFF
```

Or apply the settings from the command line:

```bash
xset s off       # Disable screen saver
xset -dpms       # Disable Display Power Management
xset s noblank   # Disable screen blanking
```

To make these persistent across reboots, add the three `xset` commands to `~/.config/autostart/`.

---

## Optional: Firewall Configuration

The following `iptables` rules provide a hardened baseline for a monitoring server — allowing only essential traffic and dropping everything else.

> **Note:** These rules are not persistent across reboots by default. To persist them, install `iptables-persistent` (`sudo apt install iptables-persistent`) and save the rules with `sudo netfilter-persistent save`.

```bash
# ── 1. Flush all existing rules ────────────────────────────────────────────
iptables -F
iptables -X
iptables -t nat -F
iptables -t mangle -F

# ── 2. Set default policies ────────────────────────────────────────────────
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# ── 3. Allow loopback traffic ──────────────────────────────────────────────
iptables -A INPUT -i lo -j ACCEPT

# ── 4. Allow established and related connections ───────────────────────────
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# ── 5. Allow SSH (prevent lockout) ─────────────────────────────────────────
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# ── 6. Allow n8watch dashboard (adjust port if changed in config.yaml) ─────
iptables -A INPUT -p tcp --dport 3000 -j ACCEPT

# ── 7. Allow VNC remote access (only if using the remote desktop setup) ────
iptables -A INPUT -p tcp --dport 5900 -j ACCEPT

# ── 8. Allow ICMP (ping) so the server itself is reachable ─────────────────
iptables -A INPUT -p icmp -j ACCEPT
```

> **Tip:** To restrict access to a trusted network only (e.g. your LAN `192.168.1.0/24`), replace `-j ACCEPT` on the dashboard and VNC rules with `-s 192.168.1.0/24 -j ACCEPT`.

---

## Optional: Backup and Restore

n8watch ships an optional `backup.sh` script that archives all critical data — the SQLite database, the YAML configuration, and generated logs — into a timestamped `.tar.gz` file. Backups can be restored to any compatible n8watch installation.

> Stop the application before restoring a backup to avoid database conflicts.

### Usage

```bash
# Create a backup (saved to ./backups/ by default)
./backup.sh --backup

# Dry-run — shows what would be backed up without writing anything
./backup.sh --backup --dry-run

# Dry-run with a custom output directory
./backup.sh --backup --dry-run --output /path/to/dir

# Create a backup in a specific directory
./backup.sh --backup --output /path/to/dir

# Restore from an existing backup archive
./backup.sh --restore /path/to/file.tar.gz

# Show help
./backup.sh --help
```

### Flags

| Flag                    | Description                                                               |
|-------------------------|---------------------------------------------------------------------------|
| `--backup`              | Create a compressed archive of the database, config, and logs             |
| `--restore <file>`      | Restore the database, config, and logs from a `.tar.gz` backup archive    |
| `--dry-run`             | Print what would be included in the backup without creating the archive   |
| `--output <dir>`        | Override the default output directory (default: `./backups/`)             |
| `--help`                | Display usage information                                                 |

### What Is Backed Up

| Item                | Path                   | Notes                                          |
|---------------------|------------------------|------------------------------------------------|
| SQLite database     | `data/n8watch.db`      | All targets, ping results, and alert records   |
| WAL / SHM sidecars  | `data/n8watch.db-wal`  | Included when present                          |
| Configuration file  | `config.yaml`          | Your current running configuration             |
| Log files           | `logs/`                | `out.log` and `error.log`                      |

### Restore

```bash
# Stop n8watch first
npm run pm2:stop   # or press Ctrl+C if running directly with node

# Restore
./backup.sh --restore /path/to/n8watch-backup-2025-01-15T12-00-00.tar.gz

# Restart
npm run pm2:start
```

> ⚠️ **Warning:** Restoring a backup **overwrites** the current database and `config.yaml`. Create a fresh backup of your existing state before restoring if you want to be able to roll back.

---

## Tech Stack

### Backend

| Package                                                                         | Purpose                          |
|---------------------------------------------------------------------------------|----------------------------------|
| [Express](https://expressjs.com)                                                | HTTP server and REST API         |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)                   | High-performance SQLite database |
| [ws](https://github.com/websockets/ws)                                         | WebSocket server                 |
| [node-cron](https://github.com/node-cron/node-cron)                            | Ping cycle scheduling            |
| [ping](https://github.com/danielzzz/node-ping)                                 | ICMP ping wrapper                |
| [nodemailer](https://nodemailer.com)                                            | SMTP email delivery              |
| [js-yaml](https://github.com/nodeca/js-yaml)                                   | YAML configuration parsing       |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | API rate limiting                |

### Frontend

| Package                                  | Purpose                   |
|------------------------------------------|---------------------------|
| [React 18](https://react.dev)            | UI framework              |
| [Vite](https://vitejs.dev)               | Build tool and dev server |
| [React Router](https://reactrouter.com)  | Client-side routing       |
| [Recharts](https://recharts.org)         | Charts and sparklines     |
| [Tailwind CSS](https://tailwindcss.com)  | Utility-first styling     |
| [Lucide React](https://lucide.dev)       | Icon library              |
| [date-fns](https://date-fns.org)         | Date formatting utilities |

---

## License

This project is licensed under the **GNU General Public License v3.0**. See [LICENSE](LICENSE) for details.
