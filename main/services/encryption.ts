import crypto from 'node:crypto'
import os from 'node:os'
import { app } from 'electron'

/**
 * Derives machine-specific encryption key from userData path and hostname.
 * Ensures encrypted data can only be decrypted on the same machine.
 */
function getEncryptionKey(): Buffer {
  const keyMaterial = app.getPath('userData') + os.hostname()
  return crypto.createHash('sha256').update(keyMaterial).digest()
}

/**
 * Encrypts data using AES-256-GCM with machine-specific key.
 */
function encryptData(plaintext: string): string | null {
  try {
    if (!plaintext) return null

    const key = getEncryptionKey()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const combined = Buffer.concat([iv, cipher.getAuthTag(), encrypted])

    return combined.toString('hex')
  } catch {
    return null
  }
}

/**
 * Decrypts data encrypted with encryptData().
 */
function decryptData(encryptedData: string): string | null {
  try {
    if (!encryptedData) return null

    const key = getEncryptionKey()
    const combined = Buffer.from(encryptedData, 'hex')

    const iv = combined.subarray(0, 16)
    const authTag = combined.subarray(16, 32)
    const encrypted = combined.subarray(32)

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8')
  } catch {
    return null
  }
}

export { encryptData, decryptData }