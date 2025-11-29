# ARC-OSC Client Setup Guide

This is currently available for closed beta testers currently, This client is for the source to be public so users know what they are using.
I would like this client to remain transparent for user privacy.

# ARC-OSC Client

Fast, transparent Electron client for ARC

## Features
- **ARC WebSocket Bridge**: Authenticate and sync avatar parameters with ARC.
- **Multi-Connection OSC**: Add and manage multiple incoming/outgoing OSC endpoints (up to 20).
- **OSC-Query Discovery**: Auto-discover services via mDNS and subscribe to paths with per-path ignore controls.
- **Live Parameter Monitor**: Real-time view of avatar parameters and OSC traffic.
- **Hyperate Integration**: Stream heart rate into VRChat parameters with muilt-ID support.
- **VRChat API Login**: Optional VRChat API.
- **OSC Leash Tools**: PhysBone leash input mapping (vertical/horizontal/run) with autostart options.

## Installation

### Prerequisites
- Node.js 24 LTS installed
- The ARC-OSC server running and accessible

### Client Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```
   - Node.js 24 LTS (compatible with Electron runtime)
   - An accessible ARC-OSC server (Live/Beta)
   ```bash
   ### Client Installation

   1. **Install dependencies:**
      ```powershell
      npm install
      ```

   2. **Start in development:**
      ```powershell
      npm run dev
      ```

   3. **Build for production:**
      ```powershell
      npm run build
      ```
2. **Local OSC Port**: Port for receiving from VRChat (default: 9001)
   ### Client Configuration

   - **Server URL**: Choose Live, Beta, or set a custom dev URL.
   - **Local OSC Port**: Default `9001` (incoming from VRChat).
   - **Target OSC Port**: Default `9000` (outgoing to VRChat).
   - **Target Address**: Default `127.0.0.1`.
   - **Secrets**: Place API keys (e.g., Hyperate) in `secrets.json` (template provided).

### Initial Setup

1. **Launch the client**
2. **Configure connection settings** in the sidebar
3. **Enter your ARC-OSC server credentials**
4. **Click "Connect & Login"**            

## Gallery
<details>

## OSC
<img width="1243" height="2160" alt="image" src="https://github.com/user-attachments/assets/38d8da14-1d7a-49aa-9ac2-8cd96278ad6b" />

## Logs

<img width="930" height="1608" alt="image" src="https://github.com/user-attachments/assets/e4f0959a-4989-4b02-b715-efa0b172634b" />

## Extras

## Custom in-house feedback with responses

<img width="1243" height="1618" alt="image" src="https://github.com/user-attachments/assets/ef324212-f9ea-4265-b191-10ed664fe089" />

## Hyperate

<img width="1241" height="922" alt="image" src="https://github.com/user-attachments/assets/5847ac32-91ca-4d5d-8f8a-01fd0e9ea9c2" />

## OSC Leash

<img width="924" height="1888" alt="image" src="https://github.com/user-attachments/assets/2bf73594-4b40-4a5c-978c-b533096909a7" />

## Settings - Live Only

<img width="935" height="686" alt="image" src="https://github.com/user-attachments/assets/80ea74a4-1ba7-4ccb-93b0-a391da495c5a" />


</details>
