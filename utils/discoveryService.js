const http = require('http');
const bonjour = require('bonjour')();

class DiscoveryService {
  constructor() {
    this.vrchatService = null;
    this.bonjourService = null;
    this.vrchatBrowser = null;
  }

  startBonjourAdvertisement(httpPort, oscPort) {
    if (this.bonjourService) {
      this.bonjourService.stop();
    }
    
    console.log('Starting Bonjour service advertisement...');
    
    // Advertise our OSC Query service using proper mDNS
    this.bonjourService = bonjour.publish({
      name: 'ARC-OSC-Client',
      type: 'oscjson',
      protocol: 'tcp',
      port: httpPort,
      host: '127.0.0.1',
      txt: {
        txtvers: '1',
        oscport: oscPort.toString(),
        oscip: '127.0.0.1',
        osctransport: 'UDP'
      }
    });

    this.bonjourService.on('up', () => {
      console.log('Bonjour service published successfully');
    });

    this.bonjourService.on('error', (err) => {
      console.error('Bonjour service error:', err);
    });

    console.log(`Published OSC Query service: ARC-OSC-Client on port ${httpPort}`);
  }

  updateBonjourService(httpPort, oscPort) {
    this.startBonjourAdvertisement(httpPort, oscPort);
  }

  startVRChatDiscovery(onVRChatFound) {
    console.log('Starting VRChat discovery with Bonjour...');
    
    // Browse for VRChat OSC Query services
    this.vrchatBrowser = bonjour.find({ type: 'oscjson', protocol: 'tcp' }, (service) => {
      console.log('Found OSC Query service:', service);
      
      // Check if this is VRChat (look for VRChat in the name)
      if (service.name && service.name.toLowerCase().includes('vrchat')) {
        console.log('Found VRChat OSC Query service via Bonjour:', service);
        
        this.vrchatService = {
          address: '127.0.0.1', // Always use localhost for VRChat
          port: service.port,
          info: service
        };
        
        // Try to get VRChat's OSC Query data, but don't fail if it doesn't work
        this.getVRChatOscQueryData(this.vrchatService, (data) => {
          if (data) {
            this.vrchatService.oscData = data;
            console.log('Retrieved VRChat OSC Query data');
          }
          
          if (onVRChatFound) onVRChatFound(this.vrchatService);
        });
      } else if (service.name && service.name.includes('ARC-OSC-Client')) {
        // This is our own service, ignore it
        console.log('Ignoring our own service advertisement');
      }
    });

    // Also try direct HTTP scanning as fallback
    setTimeout(() => {
      if (!this.vrchatService) {
        console.log('Bonjour discovery incomplete, trying direct HTTP scan...');
        this.scanForVRChatHTTP(onVRChatFound);
      }
    }, 3000);
    
    console.log('OSC Query Discovery with Bonjour started');
  }

  getVRChatOscQueryData(service, callback) {
    const testUrl = `http://127.0.0.1:${service.port}`;
    
    console.log(`Attempting to connect to VRChat OSC Query: ${testUrl}`);
    
    const req = http.get(testUrl, { 
      timeout: 5000,
      headers: {
        'User-Agent': 'ARC-OSC-Client/1.0',
        'Accept': 'application/json',
        'Connection': 'close'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log('Successfully retrieved VRChat OSC Query data');
          callback(parsed);
        } catch (err) {
          console.error('Error parsing VRChat OSC Query data:', err);
          // Don't fail completely, still try to register
          callback({ DESCRIPTION: 'VRChat', OSC_PORT: 9000 });
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('Error getting VRChat OSC Query data:', err);
      // Don't fail completely, VRChat might not respond to GET but still accept registration
      console.log('Proceeding with registration despite connection error');
      callback({ DESCRIPTION: 'VRChat', OSC_PORT: 9000 });
    });
    
    req.on('timeout', () => {
      console.log('VRChat OSC Query request timeout, proceeding with registration');
      req.destroy();
      callback({ DESCRIPTION: 'VRChat', OSC_PORT: 9000 });
    });
  }

  scanForVRChatHTTP(onVRChatFound) {
    const vrchatQueryPorts = [9000, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010];
    let foundVRChat = false;
    
    const checkPort = (port, index) => {
      setTimeout(() => {
        if (foundVRChat || this.vrchatService) return;
        
        const testUrl = `http://127.0.0.1:${port}`;
        
        const req = http.get(testUrl, { 
          timeout: 1000,
          headers: {
            'User-Agent': 'ARC-OSC-Client/1.0',
            'Accept': 'application/json',
            'Connection': 'close'
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.DESCRIPTION && (
                parsed.DESCRIPTION.toLowerCase().includes('vrchat') ||
                parsed.DESCRIPTION.toLowerCase().includes('avatar') ||
                (parsed.CONTENTS && parsed.CONTENTS.avatar)
              )) {
                foundVRChat = true;
                this.vrchatService = { 
                  address: '127.0.0.1', 
                  port: port, 
                  info: { name: 'VRChat-HTTP-Scan' },
                  oscData: parsed
                };
                console.log('Found VRChat OSC Query service via HTTP scan:', this.vrchatService);
                
                if (onVRChatFound) onVRChatFound(this.vrchatService);
              }
            } catch (err) {
              // Not VRChat or invalid JSON
            }
          });
        });
        
        req.on('error', () => {
          // Port not responding
        });
        
        req.on('timeout', () => {
          req.destroy();
        });
        
      }, index * 100); // Stagger requests
    };
    
    vrchatQueryPorts.forEach(checkPort);
  }

  stop() {
    if (this.bonjourService) {
      this.bonjourService.stop();
      this.bonjourService = null;
    }
    if (this.vrchatBrowser) {
      this.vrchatBrowser.stop();
      this.vrchatBrowser = null;
    }
    bonjour.destroy();
  }
}

module.exports = DiscoveryService;
