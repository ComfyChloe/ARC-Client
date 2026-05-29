// Bootstrap — MUST be imported first in index.ts
// Sets userData path before any service constructors run (debugger, configManager)
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
const userDataPath = path.join(process.cwd(), 'userdata')
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true })
}
app.setPath('userData', userDataPath)
