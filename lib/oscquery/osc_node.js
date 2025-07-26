const { OSCQAccess } = require('./osc_types');

function getTypeString(type) {
  if (Array.isArray(type)) {
    return "[" + type.map(getTypeString).join("") + "]";
  } else {
    return type;
  }
}

function serializeRange(range) {
  if (Array.isArray(range)) {
    return range.map(r => serializeRange(r));
  } else {
    if (range !== null) {
      return {
        MAX: range.max,
        MIN: range.min,
        VALS: range.vals,
      };
    } else {
      return null;
    }
  }
}

function assembleFullPath(node) {
  if (node.parent == null) {
    return "";
  } else {
    return assembleFullPath(node.parent) + "/" + node.name;
  }
}

function allNull(arr) {
  for (const elem of arr) {
    if (elem !== null) return false;
  }
  return true;
}

class OSCNode {
  constructor(name, parent) {
    this._name = name;
    this._parent = parent;
    this._description = undefined;
    this._access = undefined;
    this._tags = undefined;
    this._critical = undefined;
    this._args = undefined;
    this._children = {};
  }

  // null -> is root
  get parent() {
    if (this._parent) {
      return this._parent;
    } else {
      return null;
    }
  }

  get name() {
    return this._name;
  }

  _getMethodDescription(full_path) {
    const desc = {
      full_path,
    };
    if (this._description) desc.description = this._description;
    if (this._access) desc.access = this._access;
    if (this._tags) desc.tags = this._tags;
    if (this._critical) desc.critical = this._critical;
    if (this._args) desc.arguments = this._args;

    return desc;
  }

  *_methodGenerator(starting_path = "/") {
    if (!this.isContainer()) {
      yield this._getMethodDescription(starting_path);
    }

    // if we are not at the root level, add a / to separate the path from the child names
    if (starting_path !== "/") {
      starting_path += "/";
    }

    if (this._children) {
      for (const child of Object.values(this._children)) {
        for (const md of child._methodGenerator(starting_path + child.name)) {
          yield md;
        }
      }
    }
  }

  setOpts(desc) {
    this._description = desc.description;
    this._access = desc.access;
    this._tags = desc.tags;
    this._critical = desc.critical;
    this._args = desc.arguments;
  }

  setValue(arg_index, value) {
    if (!this._args || arg_index >= this._args.length) {
      throw new Error("Argument index out of range");
    }

    this._args[arg_index].value = value;
  }

  unsetValue(arg_index) {
    if (!this._args || arg_index >= this._args.length) {
      throw new Error("Argument index out of range");
    }

    delete this._args[arg_index].value;
  }

  getValue(arg_index) {
    if (!this._args || arg_index >= this._args.length) {
      return null;
    }

    return this._args[arg_index].value;
  }

  isEmpty() { // if there are no arguments and no children, the node is empty
    return !this._args && Object.keys(this._children).length == 0;
  }

  isContainer() {
    return !this._args && Object.keys(this._children).length > 0;
  }

  addChild(path, node) {
    if (path in this._children) {
      throw new Error(`The child ${path} already exist`);
    }

    this._children[path] = node;
  }

  hasChild(path) {
    return path in this._children;
  } 

  getChild(path) {
    return this._children[path];
  }

  getChildren() {
    return Object.values(this._children);
  }

  removeChild(path) {
    if (this.hasChild(path)) {
      delete this._children[path];
    }
  }

  getOrCreateChild(path) {
    if (!this.hasChild(path)) {
      this._children[path] = new OSCNode(path, this);	
    }

    return this._children[path];
  }

  serialize() {
    const full_path = assembleFullPath(this);

    const result = {
      FULL_PATH: full_path || "/",
    };

    if (this._description) result.DESCRIPTION = this._description;
    if (this._access) {
      result.ACCESS = this._access;
    } else if (this.isContainer()) {
      result.ACCESS = OSCQAccess.NO_VALUE;
    }
    if (this._tags) result.TAGS = this._tags;
    if (this._critical) result.CRITICAL = this._critical;

    if (Object.keys(this._children).length > 0) {
      result.CONTENTS = Object.fromEntries(Object.entries(this._children).map(([name, node]) => {
        return [ name, node.serialize() ]
      }));
    }

    if (this._args) {
      let arg_types = "";
      // these are set to null in case one of the args doesn't specify them
      let arg_ranges = [];
      let arg_clipmodes = [];
      const arg_values = [];

      for (const arg of this._args) {
        arg_types += getTypeString(arg.type);
        arg_values.push(arg.value ?? null);
        arg_ranges.push(arg.range ?? null);
        arg_clipmodes.push(arg.clipmode ?? null);
      }

      result.TYPE = arg_types;

      if (!allNull(arg_ranges)) {
        result.RANGE = arg_ranges.map(range => {
          if (range) {
            return serializeRange(range);
          } else {
            return null;
          }
        });
      }

      if (!allNull(arg_clipmodes)) {
        result.CLIPMODE = arg_clipmodes;
      }

      if (this._access && !allNull(arg_values) && (this._access == 1 || this._access == 3)) {
        result.VALUE = arg_values;
      }
    }

    return result;
  }
}

module.exports = { OSCNode };
