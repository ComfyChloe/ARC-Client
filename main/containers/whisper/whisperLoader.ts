// Whisper native binding loader.
//
// WHY THIS EXISTS:
// `@kutalia/whisper-node-addon` is a Node-API binding that ships its prebuilt
// `whisper.node` plus the native runtime (`whisper.dll`, `ggml*.dll`,
// `libopenblas.dll`) inside `dist/win32-x64/`. Its JS shim (`dist/js/index.js`)
// resolves `whisper.node` via `path.join(__dirname, '../win32-x64/whisper.node')`.
// In a packaged Electron build that path lands inside
// `resources/app.asar.unpacked/node_modules/@kutalia/whisper-node-addon/dist/win32-x64/`.
// Electron's restricted DLL search policy (SetDefaultDllDirectories +
// LOAD_LIBRARY_SEARCH_DEFAULT_DIRS) prevents the Win32 loader from finding
// whisper.node's native deps in the same dir — the loaded-DLL's directory is
// NOT searched for its own deps without LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR.
//
// Fix: bypass the shim's __dirname-relative resolver entirely. Load the
// `whisper.node` binding directly from our `bundledLibs/whisper/` dir, where
// the DLLs ship beside the .exe (Win32 always searches the app directory).
//
// All access to the native binding goes through the `transcribe` function we
// re-export from this module.

import fs from 'node:fs'
import path from 'node:path'

export interface WhisperTranscribeOptions {
  /** Path to the ggml model file (e.g. ggml-tiny.en.bin) */
  model: string
  /** Language code, e.g. 'en', 'auto' */
  language?: string
  /** PCM f32 audio samples, mono, in [-1, 1] */
  pcmf32: Float32Array
  /** Threads for inference; defaults to ~half of logical cores */
  n_threads?: number
  /** Whether to translate to English (instead of transcribing in source lang) */
  translate?: boolean
  /** Emit timestamps in output (we don't use them yet; for v2) */
  no_timestamps?: boolean
  /** Skip the whisper.cpp startup prints */
  no_prints?: boolean
  /** Try GPU acceleration via Vulkan if available */
  use_gpu?: boolean
}

export interface WhisperSegment {
  // The kutalia binding returns transcription as `string[] | string[][]` where
  // string[][] is per-segment. We normalise to a flat string array of lines.
}

export interface WhisperTranscribeResult {
  /** Flat list of transcription lines, one entry per spoken segment */
  text: string[]
  /** Joined full transcript */
  fullText: string
}

// Module-level singleton: the binding is loaded exactly once per process.
// Re-loading would re-init whisper.cpp's static state, which is not safe.
let cachedAddon: ((opts: any) => Promise<{ transcription: string[] | string[][] }>) | null = null

function loadAddon(): (opts: any) => Promise<{ transcription: string[] | string[][] }> {
  if (cachedAddon) return cachedAddon
  // Resolve a path to whisper.node that the Win32 loader can fully resolve
  // for its own deps (ggml*.dll, libopenblas.dll). See top-of-file note.
  const candidates: string[] = []
  // 1. Packaged build: <exe dir>/bundledLibs/whisper/whisper.node
  candidates.push(path.join(path.dirname(process.execPath), 'bundledLibs', 'whisper', 'whisper.node'))
  // 2. Dev mode fallback: <projectRoot>/build/bundledLibs/whisper/whisper.node
  candidates.push(path.join(process.cwd(), 'build', 'bundledLibs', 'whisper', 'whisper.node'))
  const found = candidates.find(p => fs.existsSync(p))
  if (!found) {
    throw new Error(
      `whisper.node not found. Tried:\n${candidates.map(p => '  ' + p).join('\n')}\n` +
      `Run \`npm run build\` to populate build/bundledLibs/whisper.`
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const addonModule = require(found) as { whisper: (opts: any, cb: (err: Error | null, result?: any) => void) => void }
  if (typeof addonModule.whisper !== 'function') {
    throw new Error(`whisper binding at ${found} did not export a 'whisper' function`)
  }
  // The native function uses Node-style callback; wrap in a promise.
  const util = require('node:util') as typeof import('node:util')
  cachedAddon = util.promisify(addonModule.whisper) as (opts: any) => Promise<{ transcription: string[] | string[][] }>
  return cachedAddon
}

// Synchronous "can the addon be loaded?" check — used by preflightWhisper()
// to surface a clear error in the UI before the user clicks Start.
export function resolveWhisperBinDir(): string | null {
  const candidates: string[] = []
  if (process.env.NODE_ENV === 'production' || process.versions.electron) {
    candidates.push(path.join(path.dirname(process.execPath), 'bundledLibs', 'whisper'))
  }
  candidates.push(path.join(process.cwd(), 'build', 'bundledLibs', 'whisper'))
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'whisper.node'))) return dir
  }
  return null
}

// Transcribe a buffer of mono float32 PCM samples. Returns the joined text
// plus a per-line split.
export async function transcribe(opts: WhisperTranscribeOptions): Promise<WhisperTranscribeResult> {
  const addon = loadAddon()
  const result = await addon({
    model: opts.model,
    pcmf32: opts.pcmf32,
    language: opts.language ?? 'en',
    n_threads: opts.n_threads ?? Math.max(1, Math.floor(require('node:os').cpus().length / 2)),
    translate: opts.translate ?? false,
    no_timestamps: opts.no_timestamps ?? true,
    no_prints: opts.no_prints ?? true,
    use_gpu: opts.use_gpu ?? false
  })
  // The binding returns either string[] (flat) or string[][] (per segment).
  // Flatten to a single array of lines.
  const raw = result.transcription
  const lines: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        lines.push(item)
      } else if (Array.isArray(item)) {
        for (const inner of item) {
          if (typeof inner === 'string') lines.push(inner)
        }
      }
    }
  }
  const fullText = lines.join(' ').trim()
  return { text: lines, fullText }
}