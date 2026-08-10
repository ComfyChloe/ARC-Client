#!/usr/bin/env node
// =====================================================================
// prepare-whisper-libs.mjs
//
// Intentionally a no-op.
//
// The previous Whisper implementation used a C# sub-process bridge
// (`WhisperBridge.exe`) that lived beside the packaged .exe via the
// `extraResources` rule mapping `build/bundledLibs/` -> sibling-of-exe
// `bundledLibs/`. That required a custom staging script to copy native
// DLLs into `build/bundledLibs/whisper/win32-x64/` because of Win32
// DLL search-order quirks.
//
// The current implementation uses @kutalia/whisper-node-addon
// (N-API binding) inside a Node worker_thread. The addon's JS shim
// at `node_modules/@kutalia/whisper-node-addon/dist/js/index.js`
// resolves the native binary via `__dirname + '../<platform>-<arch>/'`,
// i.e. the addon resolves itself using its OWN package layout — no
// sibling-of-exe trickery needed.
//
// For packaged builds:
//   * `package.json asarUnpack` extracts
//     `node_modules/@kutalia/whisper-node-addon/**/*` to
//     `app.asar.unpacked/node_modules/@kutalia/whisper-node-addon/`
//   * `worker_threads.Worker('./out/main/.../whisper-worker.js')`
//     loads the worker from the unpacked path
//   * The worker's `require('@kutalia/whisper-node-addon')` walks up
//     `node_modules/` from the worker's location and finds the
//     addon at the expected relative path
//
// This script exists only as a no-op to keep the `prebuild` npm script
// working. Future versions may copy the addon into
// `build/bundledLibs/` for self-extracted or installed-package
// deployment scenarios; for now node_modules + asarUnpack is enough.
//
// Exit 0 always.
// =====================================================================

console.log('[prepare-whisper-libs] no-op — @kutalia/whisper-node-addon resolves via node_modules + asarUnpack')
process.exit(0)