const { EventEmitter } = require('events');
const { Bonjour } = require('bonjour-service');
const axios = require('axios');
const { OSCNode } = require('./osc_node');
const { OSCTypeSimpleMap, OSCQAccessMap } = require('./osc_types');

function deserializeHostInfo(host_info) {
  return {
    name: host_info.NAME,
    extensions: host_info.EXTENSIONS,
    oscIp: host_info.OSC_IP,
    oscPort: host_info.OSC_PORT,
    oscTransport: host_info.OSC_TRANSPORT,
    wsIp: host_info.WS_IP,
    wsPort: host_info.WS_PORT,
  };
}

function parseTypeString(type_string) {
  const tokens = [];
  let current_token = "";
  let brackets_open = 0;
  
  for (const c of type_string) {
    if (c == "[" && brackets_open == 0) {
      current_token = "";
      brackets_open = 1;
    } else if (c == "[" && brackets_open > 0) {
      brackets_open += 1;
      current_token += c;
    } else if (c == "]" && brackets_open > 0) {
      brackets_open -= 1;
      if (brackets_open == 0) {
        tokens.push([ current_token ]);
      } else {
        current_token += c;
      }
    } else if (c in OSCTypeSimpleMap) {
      if (brackets_open == 0) {
        tokens.push(c);
      } else {
        current_token += c;
      }
    } // otherwise we ignore the invalid token
  }

  return tokens.map(token => {
    if (Array.isArray(token)) {
      return parseTypeString(token[0]);
    } else {
      return OSCTypeSimpleMap[token];
    }
  });
}

function deserializeRange(range) {
  if (Array.isArray(range)) {
    return range.map(r => deserializeRange(r));
  } else {
    if (range !== null) {
      return {
        min: range.MIN,
        max: range.MAX,
        vals: range.VALS,
      }
    } else {
      return null;
    }
  }
}

function deserializeMethodNode(node, parent) {
  const full_path_split = node.FULL_PATH.split("/");
  const osc_node = new OSCNode(full_path_split[full_path_split.length - 1], parent);

  if (node.CONTENTS) {
    for (const key in node.CONTENTS) {
      osc_node.addChild(key, deserializeMethodNode(node.CONTENTS[key], osc_node));
    }
  }

  let method_arguments = undefined;
  if (node.TYPE) {
    method_arguments = [];
    let arg_types = parseTypeString(node.TYPE);
    
    if (!Array.isArray(arg_types)) {
      arg_types = [ arg_types ]; // this should never happen
    }

    for (let i = 0; i < arg_types.length; i++) {
      const method_arg = {
        type: arg_types[i],
      };

      if (node.RANGE && node.RANGE[i] !== null) {
        method_arg.range = deserializeRange(node.RANGE[i]);
      }

      if (node.CLIPMODE && node.CLIPMODE[i]) {
        method_arg.clipmode = node.CLIPMODE[i];
      }

      if (node.VALUE && node.VALUE[i] !== undefined) {
        method_arg.value = node.VALUE[i];
      }

      method_arguments.push(method_arg);
    }
  }

  osc_node.setOpts({
    description: node.DESCRIPTION,
    access: node.ACCESS ? OSCQAccessMap[node.ACCESS] : undefined,
    tags: node.TAGS,
    critical: node.CRITICAL,
    arguments: method_arguments,
  });

  return osc_node;
}

class DiscoveredService {
  constructor(address, port) {
    this.address = address;
    this.port = port;
    this._hostInfo = undefined;
    this._nodes = undefined;
  }

  get hostInfo() {
    if (!this._hostInfo) {
      throw new Error("HostInfo has not been loaded yet");
    }
    return this._hostInfo;
  }

  get nodes() {
    if (!this._nodes) {
      throw new Error("Nodes have not been loaded yet");
    }
    return this._nodes;
  }

  flat() {
    return Array.from(this.nodes._methodGenerator());
  }

  async update() {
    try {
      // Handle IPv6 addresses by wrapping them in brackets
      const formattedAddress = this.address.includes(':') && !this.address.startsWith('[') 
        ? `[${this.address}]` 
        : this.address;
      
      const baseResp = await axios.get(`http://${formattedAddress}:${this.port}`);
      const hostInfoResp = await axios.get(`http://${formattedAddress}:${this.port}?HOST_INFO`);

      this._hostInfo = deserializeHostInfo(hostInfoResp.data);
      this._nodes = deserializeMethodNode(baseResp.data);
    } catch (error) {
      // Only log connection errors as warnings since many OSC Query services
      // advertise via mDNS but don't provide HTTP endpoints
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        console.warn(`OSC Query service at ${this.address}:${this.port} not accepting HTTP connections`);
      } else {
        console.error('Error updating OSCQuery service:', error.message);
      }
      throw error;
    }
  }

  resolvePath(path) {
    const path_split = path.split("/").filter(p => p !== "");

    let node = this.nodes;

    for (const path_component of path_split) {
      if (node.hasChild(path_component)) {
        node = node.getChild(path_component);
      } else {
        return null; // this endpoint doesn't exist
      }
    }

    return node;
  }
}

class OSCQueryDiscovery extends EventEmitter {
  constructor() {
    super();
    this._mdns = null;
    this._mdnsBrowser = null;
    this._services = [];
  }

  _handleUp(service) {
    if (service.protocol != "tcp") {
      return; // OSCQuery always uses TCP
    }

    if (service.addresses && service.addresses.length > 0) {
      service.addresses.forEach(address => {
        // Validate that the address is a valid IP address or hostname
        if (address && typeof address === 'string' && address.trim() !== '') {
          // Skip IPv6 localhost addresses as they can cause issues
          if (address === '::1') {
            console.log('Skipping IPv6 localhost address');
            return;
          }
          
          this.queryNewService(address, service.port).catch(err => {
            // Only log connection errors as warnings since many OSC Query services
            // advertise via mDNS but don't provide HTTP endpoints
            if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
              console.warn(`OSC Query service at ${address}:${service.port} not accepting HTTP connections`);
            } else {
              console.error(`Error querying service at ${address}:${service.port}:`, err.message);
            }
          });
        }
      });
    }
  }

  _handleDown(service) {
    service.addresses?.forEach(address => {
      const existingIndex = this._services.findIndex(s => s.address == address && s.port == service.port);

      if (existingIndex > -1) {
        const removedService = this._services[existingIndex];
        this.emit("down", removedService);
        this._services.splice(existingIndex, 1);
      }
    });
  }

  async queryNewService(address, port) {
    // Validate address and port
    if (!address || typeof address !== 'string' || address.trim() === '') {
      throw new Error('Invalid address provided');
    }
    
    if (!port || typeof port !== 'number' || port <= 0 || port > 65535) {
      throw new Error('Invalid port provided');
    }

    const service = new DiscoveredService(address, port);

    try {
      await service.update();
      this._services.push(service);
      this.emit("up", service);
      return service;
    } catch (error) {
      // Only log connection errors as warnings since many OSC Query services
      // advertise via mDNS but don't provide HTTP endpoints
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        console.warn(`OSC Query service at ${address}:${port} not accepting HTTP connections`);
      } else {
        console.error(`Failed to query service at ${address}:${port}:`, error.message);
      }
      throw error;
    }
  }

  start() {
    if (this._mdns || this._mdnsBrowser) {
      return;
    }

    this._mdns = new Bonjour(undefined, (err) => {
      this.emit("error", err);
    });

    this._mdnsBrowser = this._mdns.find({
      type: "oscjson",
      protocol: "tcp"
    });

    this._mdnsBrowser.on("up", this._handleUp.bind(this));
    this._mdnsBrowser.on("down", this._handleDown.bind(this));
  }

  stop() {
    if (!this._mdns || !this._mdnsBrowser) {
      return;
    }

    this._mdnsBrowser.stop();
    this._mdns.destroy();

    this._mdnsBrowser = null;
    this._mdns = null;
  }

  getServices() {
    return this._services;
  }
}

module.exports = { OSCQueryDiscovery, DiscoveredService };
