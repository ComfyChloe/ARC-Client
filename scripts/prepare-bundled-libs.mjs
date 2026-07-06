// Copies the Vosk native libraries (libvosk.dll + its GCC dependencies) out of
// node_modules/vosk-koffi/bin-<platform>-<arch>/ into build/bundledLibs/ so that
// electron-builder's extraResources can ship them next to the packaged app.
//
// Why: Windows DLL loader search order doesn't reliably honor a runtime-mutated
// process.env.Path for dependency resolution during LoadLibraryEx. Placing the
// dependency DLLs in a directory that's always searched (next to the .exe) is
// the only reliable fix for the "Failed to load shared library" error on
// packaged builds.
//
// Run automatically via the `prebuild` npm script.

import { copyFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(projectRoot, 'node_modules', 'vosk-koffi', `bin-${process.platform}-${process.arch}`)
const targetDir = path.join(projectRoot, 'build', 'bundledLibs')

const REQUIRED_FILES = ['libvosk.dll', 'libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libwinpthread-1.dll']

async function exists(p) {
  try { await access(p, constants.F_OK); return true } catch { return false }
}

async function main() {
  if (process.platform !== 'win32') {
    // Linux/macOS bundles different dependency names (libgcc_s.so.1, libc++.so, etc).
    // The packaged-build loader issue we're working around is Windows-specific,
    // so for non-Windows builds we just no-op. The asarUnpack entry for vosk-koffi
    // already covers the standard library lookup path on those platforms.
    console.log(`[prepare-bundled-libs] skipping on ${process.platform} (Windows-only workaround)`)
    return
  }

  if (!(await exists(sourceDir))) {
    throw new Error(`[prepare-bundled-libs] source directory missing: ${sourceDir}\nDid you run \`npm install\`?`)
  }

  const missing = []
  for (const f of REQUIRED_FILES) {
    if (!(await exists(path.join(sourceDir, f)))) missing.push(f)
  }
  if (missing.length) {
    throw new Error(`[prepare-bundled-libs] missing source files: ${missing.join(', ')}\nThe vosk-koffi package may be out of date or incomplete.`)
  }

  await mkdir(targetDir, { recursive: true })

  for (const filename of REQUIRED_FILES) {
    const src = path.join(sourceDir, filename)
    const dst = path.join(targetDir, filename)
    await copyFile(src, dst)
    console.log(`[prepare-bundled-libs] copied ${filename}`)
  }

  console.log(`[prepare-bundled-libs] done — ${targetDir}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})