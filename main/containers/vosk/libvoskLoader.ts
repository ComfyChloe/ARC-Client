// Minimal koffi-based loader for libvosk.dll.
//
// WHY THIS EXISTS:
// `vosk-koffi` (npm) calls `path.resolve(__dirname, '..', 'bin-<plat>-<arch>')`
// internally to find libvosk.dll. In a packaged Electron build that DLL lives
// inside `resources/app.asar.unpacked/node_modules/vosk-koffi/bin-win32-x64/`,
// and when koffi.node calls LoadLibraryW on it, Electron's restricted DLL
// search policy (SetDefaultDllDirectories with LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)
// prevents the Win32 loader from finding libvosk.dll's GCC runtime deps
// (libgcc_s_seh-1.dll, libstdc++-6.dll, libwinpthread-1.dll) — they're co-located
// with libvosk.dll but the loaded-DLL's directory is NOT searched for deps
// without LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR.
//
// Fix: bypass vosk-koffi's resolver and call `koffi.load(<our bundledLibs path>)`
// directly. The bundledLibs dir is co-located with the .exe and Win32 always
// searches the app directory for DLL deps.
//
// We reimplement the small subset of the vosk-koffi API surface that the rest
// of the addon uses: setLogLevel, Model, Recognizer. If you need more, mirror
// the corresponding `s.func(...)` declarations from vosk-koffi/lib/index.js.
//
// This module is loaded only after `resolveVoskBinDir()` has confirmed the
// DLL exists, so the koffi.load call here is the moment of truth.

import fs from 'node:fs'

interface KoffiLib {
  func(definition: string): (...args: unknown[]) => unknown
  func(name: string, resultType: string, ...argTypes: string[]): (...args: unknown[]) => unknown
  func(convention: string, name: string, resultType: string, ...argTypes: string[]): (...args: unknown[]) => unknown
}

interface KoffiModule {
  load(filename: string): KoffiLib
  opaque(name: string): unknown
}

// Mirror of the Recognizer interface vosk-koffi exposes, limited to what
// the addon actually calls. Keeping it narrow makes the shim safe to evolve.
// `result()` / `partialResult()` / `finalResult()` return parsed JSON objects
// (NOT raw C strings) — that matches vosk-koffi's behavior where
// `result()` does `JSON.parse(resultString() || 'null')`. The consumer in
// vosk.ts casts these to VoskFinalJson / VoskPartialJson directly.
export interface LibvoskFinalResult { text?: string; result?: { conf?: number; word?: string }[] }
export interface LibvoskPartialResult { partial?: string }
export interface LibvoskRecognizer {
  free(): void
  setWords(words: boolean): void
  acceptWaveform(data: Buffer): boolean
  result(): LibvoskFinalResult | null
  partialResult(): LibvoskPartialResult | null
  finalResult(): LibvoskFinalResult | null
  reset(): void
}

export interface LibvoskModel {
  free(): void
}

export interface LibvoskModule {
  setLogLevel(level: number): void
  Model: new (modelPath: string) => LibvoskModel
  Recognizer: new (opts: { model: LibvoskModel; sampleRate: number }) => LibvoskRecognizer
}

// Construct the full module surface from a libvosk.dll path. Throws on
// load failure with the same error string our preflightVosk() already
// surfaces to the UI.
export function loadLibvosk(dllPath: string): LibvoskModule {
  if (!fs.existsSync(dllPath)) {
    throw new Error(`libvosk.dll not found at ${dllPath}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as KoffiModule
  const lib = koffi.load(dllPath)

  // Opaque types — must be declared on the koffi module BEFORE any function
  // binding that uses them as a parameter or return type. (These are module-level
  // types, not per-library methods on koffi <=2.16.)
  koffi.opaque('VoskModel')
  koffi.opaque('VoskSpkModel')
  koffi.opaque('VoskRecognizer')

  // Function bindings — same prototypes as vosk-koffi declares.
  const vosk_set_log_level = lib.func('void vosk_set_log_level(int log_level)')
  const vosk_model_new = lib.func('VoskModel * vosk_model_new(const char *model_path)')
  const vosk_model_free = lib.func('void vosk_model_free(VoskModel *model)')
  const vosk_recognizer_new = lib.func('VoskRecognizer * vosk_recognizer_new(VoskModel *model, float sample_rate)')
  const vosk_recognizer_free = lib.func('void vosk_recognizer_free(VoskRecognizer *recognizer)')
  const vosk_recognizer_set_words = lib.func('void vosk_recognizer_set_words(VoskRecognizer *recognizer, int words)')
  const vosk_recognizer_accept_waveform = lib.func('int vosk_recognizer_accept_waveform(VoskRecognizer *recognizer, const char *data, int length)')
  const vosk_recognizer_result = lib.func('const char * vosk_recognizer_result(VoskRecognizer *recognizer)')
  const vosk_recognizer_partial_result = lib.func('const char * vosk_recognizer_partial_result(VoskRecognizer *recognizer)')
  const vosk_recognizer_final_result = lib.func('const char * vosk_recognizer_final_result(VoskRecognizer *recognizer)')
  const vosk_recognizer_reset = lib.func('void vosk_recognizer_reset(VoskRecognizer *recognizer)')

  function setLogLevel(level: number): void {
    vosk_set_log_level(level)
  }

  class Model implements LibvoskModel {
    // eslint-disable-next-line no-restricted-globals
    public readonly handle: unknown
    constructor(modelPath: string) {
      this.handle = vosk_model_new(modelPath)
    }
    free(): void {
      if (this.handle) {
        try { vosk_model_free(this.handle as never) } catch { /* already freed */ }
      }
    }
  }

  class Recognizer implements LibvoskRecognizer {
    // eslint-disable-next-line no-restricted-globals
    public readonly handle: unknown
    constructor(opts: { model: LibvoskModel; sampleRate: number }) {
      this.handle = vosk_recognizer_new((opts.model as unknown as { handle: unknown }).handle, opts.sampleRate)
    }
    free(): void {
      if (this.handle) {
        try { vosk_recognizer_free(this.handle as never) } catch { /* already freed */ }
      }
    }
    setWords(words: boolean): void {
      vosk_recognizer_set_words(this.handle as never, words ? 1 : 0)
    }
    acceptWaveform(data: Buffer): boolean {
      // libvosk accepts a signed 16-bit PCM buffer; we pass the raw bytes.
      return vosk_recognizer_accept_waveform(this.handle as never, data as unknown as string, data.length) !== 0
    }
    result(): LibvoskFinalResult | null {
      const raw = vosk_recognizer_result(this.handle as never) as string | null
      if (!raw) return null
      try { return JSON.parse(raw) as LibvoskFinalResult } catch { return null }
    }
    partialResult(): LibvoskPartialResult | null {
      const raw = vosk_recognizer_partial_result(this.handle as never) as string | null
      if (!raw) return null
      try { return JSON.parse(raw) as LibvoskPartialResult } catch { return null }
    }
    finalResult(): LibvoskFinalResult | null {
      const raw = vosk_recognizer_final_result(this.handle as never) as string | null
      if (!raw) return null
      try { return JSON.parse(raw) as LibvoskFinalResult } catch { return null }
    }
    reset(): void {
      vosk_recognizer_reset(this.handle as never)
    }
  }

  return { setLogLevel, Model, Recognizer }
}