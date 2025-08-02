# ARC-OSC Client Setup Guide

## Overview
The ARC-OSC Client is a standalone Electron application that provides a dedicated interface for sending OSC data to your ARC-OSC server via WebSocket. This solves the multi-user conflict issue by giving each user their own isolated session.

## Features
- **User Authentication**: Secure login using your ARC-OSC server credentials
- **Role-Based Access**: Different permission levels (Admin, Moderator, User)
- **User Isolation**: Each user maintains their own avatar state and parameters
- **Real-time OSC**: Bidirectional OSC communication with VRChat
- **Parameter Monitoring**: Live view of avatar parameters
- **Manual OSC Sending**: Direct OSC message transmission

## Installation

### Prerequisites
- Node.js 18+ installed
- Your ARC-OSC server running and accessible

### Client Installation

1. **Navigate to the client directory:**
   ```bash
   cd osc-client
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the client in development mode:**
   ```bash
   npm run dev
   ```

4. **Or build for production:**
   ```bash
   npm run build
   ```

### VRChat Configuration

Configure VRChat to send OSC data to the client:

1. **In VRChat**, go to Settings → OSC
2. **Configure OSC ports** to match the client settings
3. **Enable OSC**

### Client Configuration

1. **Server URL**: Point to your ARC-OSC server (e.g., `ws://localhost:3000`)
2. **Local OSC Port**: Port for receiving from VRChat (default: 9001)
3. **Target OSC Port**: Port for sending to VRChat (default: 9000)
4. **Target Address**: VRChat's IP address (usually 127.0.0.1)

## Usage

### Initial Setup

1. **Launch the client**
2. **Configure connection settings** in the sidebar
3. **Enter your ARC-OSC server credentials**
4. **Click "Connect & Login"**