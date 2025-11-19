const crypto = require('crypto');
const os = require('os');
const { app } = require('electron');
const debug = require('./debugger');
/**
 * Machine-specific encryption key generation
 * Derives key from machine-specific data (userData path + hostname)
 * This ensures encrypted data can only be decrypted on the same machine
 */
function getEncryptionKey() {
  const keyMaterial = app.getPath('userData') + os.hostname();
  return crypto.createHash('sha256').update(keyMaterial).digest();
}
/**
 * Encrypt sensitive data using AES-256-GCM
 * @param {string} plaintext - The data to encrypt
 * @returns {string|null} Base64-encoded encrypted data with IV and auth tag
 */
function encryptData(plaintext) {
  try {
    if (!plaintext) return null;
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16); // 128-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    // Combine IV + AuthTag + Encrypted data for storage
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'base64')
    ]);
    return combined.toString('base64');
  } catch (error) {
    debug.error(`Encryption error: ${error.message}`);
    return null;
  }
}
/**
 * Decrypt data encrypted with encryptData()
 * @param {string} encryptedData - Base64-encoded encrypted data
 * @returns {string|null} Decrypted plaintext or null if decryption fails
 */
function decryptData(encryptedData) {
  try {
    if (!encryptedData) return null;
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedData, 'base64');
    // Extract IV (16 bytes), AuthTag (16 bytes), and encrypted data
    const iv = combined.slice(0, 16);
    const authTag = combined.slice(16, 32);
    const encrypted = combined.slice(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    debug.error(`Decryption error: ${error.message}`);
    return null;
  }
}
module.exports = {
  encryptData,
  decryptData
};