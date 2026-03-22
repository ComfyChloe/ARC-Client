<div align="center">

# ARC-OSC Client

**The transparent, feature-rich desktop bridge for VRChat remote control**

[![Version](https://img.shields.io/badge/version-0.90.2-blue.svg)](https://github.com/ComfyChloe/ARC-Client)
[![Electron](https://img.shields.io/badge/electron-33.0.0-47848F.svg?logo=electron&logoColor=white)](https://electronjs.org/)
[![License](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-Open%20Beta-brightgreen.svg)]()

*Seamlessly bridge VRChat OSC with the ARC, privacy-first, open-source, and fully transparent.*

---

[Features](#-features) • [Installation](#-installation) • [Configuration](#%EF%B8%8F-configuration) • [Gallery](#-gallery) • [Documentation](#-documentation)

</div>

---

## 📋 About

ARC-OSC Client is a standalone Electron desktop application that serves as the bridge between VRChat and the ARC-OSC server. It enables real-time avatar parameter synchronization, heart rate streaming, VRChat API integration, and a Vue 3 + TypeScript desktop interface built on Electron Vite.

> **🔒 Transparency First**: This client's source code is public to ensure users know exactly what they're running. Privacy matters.

---

## ✨ Features

### 🌐 ARC WebSocket Bridge
Connect seamlessly to the ARC-OSC server infrastructure. Authenticate with your credentials and enjoy real-time bidirectional synchronization of avatar parameters between VRChat and the web dashboard.

- Secure authentication with username/password
- Automatic reconnection handling
- Support for Live, Beta, and custom server URLs
- Real-time parameter sync

<details>
<summary>📸 Preview</summary>

<!-- Add your ARC connection screenshot here -->
*Screenshot placeholder: ARC Connection Panel*

</details>

### 📡 Multi-Connection OSC
Manage up to **20 simultaneous OSC endpoints** for complex setups. Perfect for advanced users running multiple applications that need OSC data.

- Add/remove endpoints dynamically
- Configure incoming and outgoing ports independently
- Per-connection enable/disable controls
- Visual connection status indicators

<details>
<summary>📸 Preview</summary>

<img width="100%" alt="OSC Multi-Connection Panel" src="https://github.com/user-attachments/assets/38d8da14-1d7a-49aa-9ac2-8cd96278ad6b" />

</details>

### 🔍 OSC-Query Discovery
Leverage automatic service discovery via **mDNS/Bonjour** to find and connect to OSC-compatible applications on your network. VRChat's OSC Query protocol is fully supported.

- Auto-discover services on your local network
- Subscribe to specific parameter paths
- Per-path ignore controls for filtering unwanted data
- Persistent discovery across sessions

<details>
<summary>📸 Preview</summary>

<!-- Add your OSC-Query screenshot here -->
*Screenshot placeholder: OSC-Query Discovery Panel*

</details>

### 📊 Live Parameter Monitor
Watch your avatar parameters update in real-time with a comprehensive monitoring view. Debug OSC traffic, verify parameter values, and troubleshoot issues with ease.

- Real-time parameter value display
- OSC traffic logging with timestamps
- Filter and search functionality
- Export logs for debugging

<details>
<summary>📸 Preview</summary>

<img width="100%" alt="Logs and Parameter Monitor" src="https://github.com/user-attachments/assets/e4f0959a-4989-4b02-b715-efa0b172634b" />

</details>

### 💓 HypeRate Integration
Stream your heart rate directly into VRChat avatar parameters using **HypeRate** devices. Supports multiple tracker IDs for multi-user setups or backup devices.

- Connect via HypeRate WebSocket API
- Multi-tracker support with primary selection
- Custom tracker naming
- Auto-reconnection on connection loss
- Real-time heart rate display

<details>
<summary>📸 Preview</summary>

<img width="100%" alt="HypeRate Integration Panel" src="https://github.com/user-attachments/assets/5847ac32-91ca-4d5d-8f8a-01fd0e9ea9c2" />

</details>

### 🎮 VRChat API Integration
Optional VRChat API login for enhanced features. Access your friends list, current instance information, and more — with full 2FA support.

- Account statistics dashboard
- Auto-Status integration
- Auto-Inviter (Future releases)

<details>
<summary>📸 Preview</summary>

<!-- Add your VRChat API screenshot here -->
*Screenshot placeholder: VRChat API Panel*

</details>

### 🤖 Auto-Status Automation
Manage VRChat status presets directly from the client and trigger them through OSC or scheduled time windows.

- Configure up to 8 status presets
- Set status color and optional status message
- Trigger presets from OSC parameters
- Schedule preset windows with fallback statuses
- Detect externally changed statuses and avoid overwriting them
- Load the current VRChat account status on startup when VRChat API is available

<details>
<summary>📸 Preview</summary>

<!-- Add your Auto-Status screenshot here -->
*Screenshot placeholder: Auto-Status Panel*

</details>

### 🗓️ VRC Timeline
Browse VRChat community events directly inside the client through the integrated VRC Timeline view.

- Embedded `vrc.tl` webview
- Safe external-link interception
- Quick copy/open actions for external URLs
- Experimental in-client browsing support

<details>
<summary>📸 Preview</summary>

<!-- Add your VRC Timeline screenshot here -->
*Screenshot placeholder: VRC Timeline Panel*

</details>

### 🦮 OSC Leash Tools
Transform PhysBone leash inputs into VRChat movement controls. Get pulled around by your friends with configurable sensitivity, dead zones, and directional mapping.

- **Directional Control**: Forward, backward, left, right, up, down
- **Movement Modes**: Walk and run with configurable thresholds
- **Fine-tuning Options**:
  - Run/Walk dead zones
  - Strength multiplier
  - Up/down compensation
  - Active/inactive update delays
- **Multi-leash Support**: Configure multiple PhysBone parameters
- **Autostart Option**: Begin leash control on app launch

<details>
<summary>📸 Preview</summary>

<img width="100%" alt="OSC Leash Configuration" src="https://github.com/user-attachments/assets/2bf73594-4b40-4a5c-978c-b533096909a7" />

</details>

### 🎮 OSCGoesBrrr - Haptic Device Integration
Connect Bluetooth haptic devices (via Buttplug.io/Intiface Central) to your VRChat avatar for immersive tactile feedback. Control toy vibration based on avatar contacts and penetration depth.

- **Real-time Haptic Feedback**: Responds to VRCFury Haptics and TPS penetration systems
- **Multi-Device Support**: Configure multiple toys independently with per-device settings
- **Flexible Source Filtering**: 
  - Touch (self/others)
  - Penetration (self/others)
  - Frot (others)
- **Advanced Control Options**:
  - Depth-based or Motion-based vibration modes
  - Intensity multiplier (0.1x - 2.0x)
  - Idle vibration baseline
  - Per-device source filtering
- **Device Management**:
  - Battery level monitoring
  - Real-time activity display
  - Device configuration
- **Intiface Central Integration**: Connect via WebSocket to Intiface Central server

<details>
<summary>📸 Preview</summary>

<!-- Add your OSCGoesBrrr screenshot here -->
*Screenshot placeholder: OSCGoesBrrr Panel showing connected devices and configuration*

</details>

### 💬 Feedback System
Built-in feedback system to communicate directly with the development team. Submit bug reports, feature requests, or general feedback without leaving the app.

<details>
<summary>📸 Preview</summary>

<img width="100%" alt="Feedback System" src="https://github.com/user-attachments/assets/ef324212-f9ea-4265-b191-10ed664fe089" />

</details>

---

## 🚀 Installation

### Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js** | v24 LTS (recommended) |
| **ARC-OSC Server** | Access to a running instance (Live or Beta) |
| **VRChat** | With OSC enabled in settings |
| **Intiface Central** | (Optional) For OSCGoesBrrr haptic device support |

### Quick Start

```powershell
# Clone the repository
git clone https://github.com/ComfyChloe/ARC-Client.git
cd ARC-Client

# Install dependencies
npm install

# Start in development mode
npm run dev
```

### Build for Production

```powershell
# Create unpacked Windows distribution
npm run build
```

The built application will be available in the `dist/win-unpacked/` folder. The normal build process does not create an all-in-one installer.

---

## ⚙️ Configuration

### Server Connection

| Setting | Default | Description |
|---------|---------|-------------|
| Server URL | Live | Choose between Live, Beta, or custom URL |
| Username | — | Your ARC-OSC account username |
| Password | — | Your ARC-OSC account password |

### OSC Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Local OSC Port | `9001` | Port for receiving data from VRChat |
| Target OSC Port | `9000` | Port for sending data to VRChat |
| Target Address | `127.0.0.1` | VRChat's IP address (localhost for local) |

### API Keys & Secrets

Create a `secrets.json` file in the root directory using `secrets.example.json` as a template:

```json
{
  "hyperate_api_key": "your-hyperate-api-key-here"
}
```

### OSCGoesBrrr Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Intiface Address | `127.0.0.1` | IP address of Intiface Central server |
| Intiface Port | `12345` | WebSocket port for Intiface Central |
| Use WSS | `false` | Enable secure WebSocket (wss://) |

**Per-Device Settings:**
- **Source Type**: Filter by penetrator type (all, penetrator, orifice)
- **Enabled Sources**: Toggle individual contact types (touch, penetration, frot)
- **Intensity Multiplier**: Scale haptic strength (0.1x - 2.0x)
- **Idle Vibration**: Baseline vibration when in contact (0-100%)
- **Vibration Mode**: Depth-based (penetration depth) or Motion-based (thrusting speed)

<details>
<summary>📸 Settings Preview</summary>

<img width="100%" alt="Settings Panel" src="https://github.com/user-attachments/assets/80ea74a4-1ba7-4ccb-93b0-a391da495c5a" />

</details>

---

## 🖼️ Gallery

Explore the ARC-OSC Client interface through these screenshots:

<details>
<summary>🌐 <b>Main OSC Dashboard</b></summary>

<img width="100%" alt="OSC Dashboard" src="https://github.com/user-attachments/assets/38d8da14-1d7a-49aa-9ac2-8cd96278ad6b" />

*The main OSC panel showing multi-connection management and parameter monitoring.*

</details>

<details>
<summary>📊 <b>Logs & Monitoring</b></summary>

<img width="100%" alt="Logs Panel" src="https://github.com/user-attachments/assets/e4f0959a-4989-4b02-b715-efa0b172634b" />

*Real-time logging view for debugging OSC traffic and monitoring parameter changes.*

</details>

<details>
<summary>💓 <b>HypeRate Heart Monitor</b></summary>

<img width="100%" alt="HypeRate Panel" src="https://github.com/user-attachments/assets/5847ac32-91ca-4d5d-8f8a-01fd0e9ea9c2" />

*HypeRate integration panel showing heart rate streaming configuration.*

</details>

<details>
<summary>🦮 <b>OSC Leash Control</b></summary>

<img width="100%" alt="OSC Leash Panel" src="https://github.com/user-attachments/assets/2bf73594-4b40-4a5c-978c-b533096909a7" />

*Leash configuration panel with sensitivity controls and directional parameter mapping.*

</details>

<details>
<summary>💬 <b>Feedback System</b></summary>

<img width="100%" alt="Feedback Panel" src="https://github.com/user-attachments/assets/ef324212-f9ea-4265-b191-10ed664fe089" />

*Built-in feedback system for communicating with the development team.*

</details>

<details>
<summary>⚙️ <b>Settings Panel</b></summary>

<img width="100%" alt="Settings" src="https://github.com/user-attachments/assets/80ea74a4-1ba7-4ccb-93b0-a391da495c5a" />

*Configuration settings for server connection and OSC parameters.*

</details>

---

## 📚 Documentation

### Guides
├──── Intiface Central (Buttplug.io)
         │                      
| Guide | Description |
|-------|-------------|
| [OSC Leash Setup](Guides/OSC-Leash%20Setup.md) | Complete Unity prefab setup guide for avatar-side leash configuration |

### Technical Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    VRChat       │────▶│  ARC-OSC Client  │────▶│  ARC-OSC Server │
│  (OSC @ 9001)   │◀────│ (Electron/Vue/TS)│◀────│   (WebSocket)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                      │
         │                      ├──── HypeRate WebSocket
         │                      ├──── VRChat API
         │                      └──── OSC-Query mDNS
         │
         └──── OSC @ 9000 (outgoing)
```

### File Structure

```
ARC-Client/
├── main/                # Electron main process (TypeScript)
│   ├── index.ts         # App entry and IPC registration
│   ├── containers/      # Feature containers and integrations
│   ├── services/        # Core services (OSC, WebSocket, config, encryption)
│   └── types/           # Shared type declarations
├── preload/             # Secure preload bridge (TypeScript)
│   └── index.ts
├── renderer/            # Electron renderer root
│   ├── index.html       # Main renderer entry
│   ├── splash.html      # Startup splash screen
│   └── src/             # Vue 3 + TypeScript application
│       ├── App.vue      # Shell and navigation
│       ├── pages/       # Routed feature pages
│       ├── composables/ # Shared feature state / IPC wrappers
│       └── assets/      # Global styles
├── electron.vite.config.ts # Electron Vite build configuration
├── package.json         # Dependencies & scripts
├── secrets.json         # API keys (user-created)
├── tsconfig.json        # Shared TypeScript config
├── tsconfig.node.json   # Main/preload TypeScript config
├── tsconfig.web.json    # Renderer TypeScript config
├── Guides/              # User documentation
├── userdata/            # Persistent user configuration
└── dist/                # Built output (`win-unpacked`)
```

---

## 🤝 Contributing

This project is currently in **Open beta**. If you're interested in contributing, please reach out through the discord server.

---

## 📄 License

This project is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** (CC BY-NC-SA 4.0) — see the [LICENSE](LICENSE) file for details.

This means you are free to share and adapt this work for non-commercial purposes, as long as you give appropriate credit and distribute any derivatives under the same license.

---

<div align="center">

**Made with ❤️ by ComfyChloe**
</div>
