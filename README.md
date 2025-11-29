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

Main view
<img width="1184" height="845" alt="image" src="https://github.com/user-attachments/assets/3ce343e9-e791-4c0c-83d0-645718087484" />


OSC Page with 20 additional connections with soft handling

<img width="1184" height="918" alt="image" src="https://github.com/user-attachments/assets/0c4c1f6a-17b2-490b-8ab2-29408c73a654" />
<img width="846" height="630" alt="image" src="https://github.com/user-attachments/assets/b4a0cc73-9b79-461e-a1e7-74e13fd94851" />

Logs view - WIP, Currently working on improvements for future debugging

<img width="1184" height="761" alt="image" src="https://github.com/user-attachments/assets/90af03c9-1569-4c54-b7ed-e6be26291476" />

Settings - Basic with no additions

<img width="1184" height="761" alt="image" src="https://github.com/user-attachments/assets/fdddcfa7-e368-46e1-8381-0502934444da" />





