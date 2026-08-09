// Copies the Whisper native libraries (whisper.dll, whisper.node + ggml + libopenblas
// deps) out of node_modules/@kutalia/whisper-node-addon/dist/<plat>-<arch>/ into
// build/bundledLibs/whisper/ so that electron-builder's extraResources can ship them
// next to the packaged app.
//
// Why: Windows DLL loader search order doesn't reliably honor a runtime-mutated
// process.env.Path for dependency resolution during LoadLibraryEx. Placing the
// dependency DLLs in a directory that's always searched (next to the .exe) is
// the only reliable fix for the "Failed to load shared library" error on
// packaged builds. Mirrors scripts/prepare-bundled-libs.mjs but for Whisper.
//
// Run automatically via the `prebuild` npm script.

import { copyFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(
  projectRoot,
  'node_modules',
  '@kutalia',
  'whisper-node-addon',
  'dist',
  `win32-${process.arch}`
)
const targetDir = path.join(projectRoot, 'build', 'bundledLibs', 'whisper')

// The Windows x64 bundle ships whisper.dll + ggml backends + libopenblas (the
// CPU BLAS backend). We also copy whisper.node so the Node addon itself loads
// from beside the .exe — same Win32 search-order trick that fixes the DLL
// dep chain. asarUnpack in package.json unpacks the asar.unpacked copy at
// runtime so process.dlopen works.
const REQUIRED_FILES = [
  'whisper.dll',
  'whisper.node',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu.dll',
  'ggml-blas.dll',
  'libopenblas.dll'
]

async function exists(p) {
  try { await access(p, constants.F_OK); return true } catch { return false }
}

async function main() {
  if (process.platform !== 'win32') {
    // Same rationale as prepare-bundled-libs.mjs: Windows-only workaround for
    // the DLL loader search policy. Non-Windows builds load the package's
    // prebuilt binaries via the asarUnpack entry directly.
    console.log(`[prepare-whisper-libs] skipping on ${process.platform} (Windows-only workaround)`)
    return
  }

  if (!(await exists(sourceDir))) {
    throw new Error(
      `[prepare-whisper-libs] source directory missing: ${sourceDir}\n` +
      `Did you run \`npm install\`?`
    )
  }

  const missing = []
  for (const f of REQUIRED_FILES) {
    if (!(await exists(path.join(sourceDir, f)))) missing.push(f)
  }
  if (missing.length) {
    throw new Error(
      `[prepare-whisper-libs] missing source files: ${missing.join(', ')}\n` +
      `The @kutalia/whisper-node-addon package may be out of date or incomplete.`
    )
  }

  await mkdir(targetDir, { recursive: true })

  for (const filename of REQUIRED_FILES) {
    const src = path.join(sourceDir, filename)
    const dst = path.join(targetDir, filename)
    await copyFile(src, dst)
    console.log(`[prepare-whisper-libs] copied ${filename}`)
  }

  console.log(`[prepare-whisper-libs] done — ${targetDir}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})