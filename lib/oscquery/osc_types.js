// OSC Types and Constants
const OSCTypeSimple = {
  // standard:
  INT: "i",
  FLOAT: "f",
  STRING: "s",
  BLOB: "b",
  
  // non-standard:
  BIGINT: "h",
  TIMETAG: "t",
  DOUBLE: "d",
  ALTSTRING: "S",
  CHAR: "c",
  COLOR: "r",
  MIDI: "m",
  TRUE: "T",
  FALSE: "F",
  NIL: "N",
  INFINITUM: "I",
};

const OSCTypeSimpleMap = {
  "i": OSCTypeSimple.INT,
  "f": OSCTypeSimple.FLOAT,
  "s": OSCTypeSimple.STRING,
  "b": OSCTypeSimple.BLOB,
  "h": OSCTypeSimple.BIGINT,
  "t": OSCTypeSimple.TIMETAG,
  "d": OSCTypeSimple.DOUBLE,
  "S": OSCTypeSimple.ALTSTRING,
  "c": OSCTypeSimple.CHAR,
  "r": OSCTypeSimple.COLOR,
  "m": OSCTypeSimple.MIDI,
  "T": OSCTypeSimple.TRUE,
  "F": OSCTypeSimple.FALSE,
  "N": OSCTypeSimple.NIL,
  "I": OSCTypeSimple.INFINITUM,
};

const OSCQAccess = {
  NO_VALUE: 0,
  READONLY: 1,
  WRITEONLY: 2,
  READWRITE: 3,
  NA: 0,
  R: 1,
  W: 2,
  RW: 3,
};

const OSCQAccessMap = {
  0: OSCQAccess.NO_VALUE,
  1: OSCQAccess.READONLY,
  2: OSCQAccess.WRITEONLY,
  3: OSCQAccess.READWRITE,
};

module.exports = {
  OSCTypeSimple,
  OSCTypeSimpleMap,
  OSCQAccess,
  OSCQAccessMap,
};
