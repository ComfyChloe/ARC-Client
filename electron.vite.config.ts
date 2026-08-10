import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'main/index.ts'),
          // Whisper worker_thread entry point. Bundled as a separate
          // chunk so `new Worker('./whisper-worker.js')` works after
          // rollup emits it. The worker is listed in package.json
          // asarUnpack because fs.readFileSync can't read files from
          // inside the asar virtual FS.
          'whisper-worker': resolve(__dirname, 'main/containers/whisper/whisper-worker.js')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload/index.ts'),
          splash: resolve(__dirname, 'preload/splash.ts')
        }
      }
    } 
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    publicDir: resolve(__dirname, 'Assets'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html'),
          splash: resolve(__dirname, 'renderer/splash.html')
        }
      }
    },
    plugins: [vue()]
  }
})
