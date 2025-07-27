const http = require('http');
const { getResponder, Protocol } = require('@homebridge/ciao');
const portfinder = require('portfinder');
const { OSCNode } = require('./osc_node');
const { OSCQAccess } = require('./osc_types');

const EXTENSIONS = {
  ACCESS: true,
  VALUE: true,
  RANGE: true,
  DESCRIPTION: true,
  TAGS: true,
  CRITICAL: false,  // Match VRChat's settings
  CLIPMODE: false,  // Match VRChat's settings
};

const VALID_ATTRIBUTES = [
  "FULL_PATH",
  "CONTENTS",
  "TYPE",
  "ACCESS",
  "RANGE",
  "DESCRIPTION",
  "TAGS",
  "CRITICAL",
  "CLIPMODE",
  "VALUE",
  "HOST_INFO",
];

function respondJson(json, res) {
  res.setHeader("Content-Type", "application/json");
  res.write(JSON.stringify(json));
  res.end();
}

class OSCQueryServer {
  constructor(opts = {}) {
    this._opts = opts;
    this._server = http.createServer(this._httpHandler.bind(this));
    this._mdns = getResponder();
    this._mdnsService = null;
    this._root = new OSCNode("");

    // Validate that oscPort is provided - it's required for proper OSCQuery operation
    if (!this._opts.oscPort) {
      throw new Error("oscPort is required - this should be the UDP port where OSC messages are sent/received");
    }

    this._root.setOpts({
      description: this._opts.rootDescription || "root node",
      access: OSCQAccess.NO_VALUE,
    });
  }

  _httpHandler(req, res) {
    if (req.method != "GET") {
      res.statusCode = 400;
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    return this._handleGet(url, res);
  }

  _handleGet(url, res) {
    const query = (url.search.length > 0) ? url.search.substring(1) : null;
    const path_split = url.pathname.split("/").filter(p => p !== "");

    if (query && !VALID_ATTRIBUTES.includes(query)) {
      res.statusCode = 400;
      return res.end();
    }

    if (query == "HOST_INFO") {
      const hostInfo = {
        NAME: this._opts.oscQueryHostName || this._opts.serviceName,
        EXTENSIONS,
        OSC_IP: this._opts.oscIp || this._opts.bindAddress || "127.0.0.1",
        OSC_PORT: this._opts.oscPort,
        OSC_TRANSPORT: this._opts.oscTransport || "UDP",
      };

      return respondJson(hostInfo, res);
    }

    let node = this._root;

    for (const path_component of path_split) {
      if (node.hasChild(path_component)) {
        node = node.getChild(path_component);
      } else {
        res.statusCode = 404;
        return res.end();
      }
    }

    if (!query) {
      return respondJson(node.serialize(), res);
    } else {
      const serialized = node.serialize();

      const access = serialized.ACCESS;
      if (access !== undefined) {
        if ((access == 0 || access == 2) && query == "VALUE") {
          res.statusCode = 204;
          return res.end();
        }
      }

      return respondJson({
        [query]: serialized[query],
      }, res);
    }
  }

  _getNodeForPath(path) {
    const path_split = path.split("/").filter(p => p !== "");

    let node = this._root;

    for (const path_component of path_split) {
      if (node.hasChild(path_component)) {
        node = node.getChild(path_component);
      } else {
        return null; // this endpoint doesn't exist
      }
    }

    return node;
  }

  async start() {
    try {
      // Always use portfinder to find an available port in the 11000-58000 range
      // This mimics the sidecar approach where a separate process manages port assignment
      this._opts.httpPort = await portfinder.getPortPromise({
        startPort: 11000,  // Start from a reasonable port range
        stopPort: 58000    // Stay within reasonable range
      });
      
      console.log(`OSCQuery HTTP server assigned to port ${this._opts.httpPort}`);

      // Create a promise for when the HTTP server is listening
      const httpListenPromise = new Promise(resolve => {
        this._server.listen(this._opts.httpPort, this._opts.bindAddress || "127.0.0.1", () => {
          console.log(`OSCQuery HTTP server listening on ${this._opts.bindAddress || "127.0.0.1"}:${this._opts.httpPort}`);
          resolve();
        });
      });

      // Create the mDNS service advertisement
      this._mdnsService = this._mdns.createService({
        name: this._opts.serviceName || "OSCQuery",
        type: "oscjson",
        port: this._opts.httpPort,
        protocol: Protocol.TCP,
      });

      // Listen for name changes and store the actual name
      this._mdnsService.on('name-change', (name) => {
        this._actualServiceName = name;
        console.log(`OSCQuery service name assigned as: ${name}`);
      });

      // Wait for both the HTTP server to start and mDNS to advertise
      await Promise.all([
        httpListenPromise,
        this._mdnsService.advertise(),
      ]);

      return {
        name: this._actualServiceName || this._opts.oscQueryHostName || this._opts.serviceName,
        extensions: EXTENSIONS,
        oscIp: this._opts.oscIp || this._opts.bindAddress || "127.0.0.1",
        oscPort: this._opts.oscPort,  // This is the actual OSC UDP port we're reporting
        oscTransport: this._opts.oscTransport || "UDP",
        http_port: this._opts.httpPort,  // This is the OSCQuery HTTP port
        osc_port: this._opts.oscPort,    // This is the OSC data port (UDP)
      };
    }
    catch (err) {
      console.error("Error starting OSCQuery server:", err);
      throw err;
    }
  }

  async stop() {
    const httpEndPromise = new Promise((resolve, reject) => {
      this._server.close(err => err ? reject(err) : resolve());
    });

    await Promise.all([
      httpEndPromise,
      this._mdnsService ? this._mdnsService.end() : Promise.resolve(),
    ]);
  }

  addMethod(path, params) {
    const path_split = path.split("/").filter(p => p !== "");

    let node = this._root;

    for (const path_component of path_split) {
      node = node.getOrCreateChild(path_component);
    }

    node.setOpts(params);
  }

  removeMethod(path) {
    let node = this._getNodeForPath(path);

    if (!node) return;

    node.setOpts({}); // make the node into an empty container

    // go back through the nodes in reverse and delete nodes until we have either reached the root or
    // hit a non-empty one
    while (node.parent != null && node.isEmpty()) {
      node.parent.removeChild(node.name);
      node = node.parent;
    }
  }

  setValue(path, arg_index, value) {
    const node = this._getNodeForPath(path);

    if (node) {
      node.setValue(arg_index, value);
    }
  }

  unsetValue(path, arg_index) {
    const node = this._getNodeForPath(path);

    if (node) {
      node.unsetValue(arg_index);
    }
  }
}

module.exports = { OSCQueryServer };
