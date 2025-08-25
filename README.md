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

1. **Server URL**: Point to your ARC-OSC server (e.g., `wss://avatar.comfychloe.uk:48255`)
2. **Local OSC Port**: Port for receiving from VRChat (default: 9001)
3. **Target OSC Port**: Port for sending to VRChat (default: 9000)
4. **Target Address**: VRChat's IP address (usually 127.0.0.1)

## Usage

### Initial Setup

1. **Launch the client**
2. **Configure connection settings** in the sidebar
3. **Enter your ARC-OSC server credentials**
4. **Click "Connect & Login"**

### Features

#### Authentication
- Uses the same user system as your web interface
- Supports role-based permissions
- Secure WebSocket connection

#### Avatar Management
- Each user has their own avatar session
- Parameter changes only affect your session
- Real-time parameter monitoring

#### OSC Communication
- Automatic forwarding of VRChat OSC to server
- Manual OSC message sending
- Live activity logging

## Server-Side Enhancements

### New Admin Features

The server now includes enhanced admin capabilities:

#### Admin API Endpoints (`/api/admin/`)
- `GET /users` - List all users
- `GET /user-sessions` - View active user sessions
- `POST /disconnect-user` - Force disconnect a user
- `POST /update-user-role` - Change user permissions
- `GET /stats` - Server statistics
- `GET /logs` - System logs

#### Enhanced User Roles

**Admin** (`admin`):
- Full system access
- User management
- Server configuration
- All OSC and panel features

**Moderator** (`moderator`):
- User monitoring
- OSC control
- Panel access
- API access

**User** (`user`):
- Panel access
- OSC control
- Personal avatar management

### User Isolation Features

1. **Separate Avatar Sessions**: Each user maintains their own avatar state
2. **Parameter Isolation**: Parameter changes are user-specific
3. **Session Management**: Track and manage individual user sessions
4. **Connection Logging**: Monitor user connections and activity

## Configuration Options

### Server Configuration (`config.yml`)

```yaml
server:
  require_auth_for_panels: false  # Set to true to require auth for web panels
  allow_registration: true        # Allow new user registration
  
users:
  - username: "admin"
    password: "$2b$10$..."
    role: "admin"
  - username: "user1"  
    password: "$2b$10$..."
    role: "user"
```

### Client Configuration

The client stores configuration locally and allows runtime updates:
- Server URL and ports
- OSC routing settings
- Connection preferences

## Troubleshooting

### Connection Issues
1. **Check server is running** and accessible
2. **Verify WebSocket URL** is correct
3. **Check firewall settings** for OSC ports
4. **Ensure authentication** credentials are correct

### OSC Issues
1. **Verify VRChat OSC settings** match client ports
2. **Check parameter addresses** are correct
3. **Monitor logs** for error messages
4. **Test with manual OSC sending**
5. **Ensure OSC ports are not in use by other applications**

### Permission Issues
1. **Check user role** has required permissions
2. **Verify authentication** is successful
3. **Contact admin** for role updates

## Development

### Building the Client

```bash
# Development mode
npm run dev

# Build for current platform
npm run build

# Package for distribution
npm run pack
```

### Customization

The client is built with:
- **Electron** for desktop app framework
- **Vanilla JavaScript** for simplicity
- **Socket.IO** for WebSocket communication
- **node-osc** for OSC protocol

You can customize:
- UI styling in `renderer/index.html`
- Application logic in `renderer/app.js`
- Main process in `main.js`

## Security Considerations

1. **Authentication Required**: All OSC clients must authenticate
2. **Session Management**: Secure session handling
3. **Role-Based Access**: Granular permission control
4. **Connection Logging**: Monitor all connections
5. **Secure Communication**: WebSocket with session validation

## Support

For issues or questions:
1. Check the application logs
2. Verify server connectivity
3. Review configuration settings
4. Contact your ARC-OSC administrator
