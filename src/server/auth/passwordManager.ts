/**
 * Password Manager Module
 * Handles MD5-hashed password storage in ./data/password.txt
 * Default password: 123456
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'

// Data directory for password file
const DATA_DIR = path.resolve(process.cwd(), 'data')
const PASSWORD_FILE = path.join(DATA_DIR, 'password.txt')

// Default password
const DEFAULT_PASSWORD = '123456'

// Session store (in-memory)
const sessions = new Map<string, { createdAt: number; expiresAt: number }>()
const SESSION_TTL = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Compute MD5 hash of a string
 */
function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex').toLowerCase()
}

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

/**
 * Initialize password file with default password if not exists
 * Also recreates if the file was deleted
 */
export function initPassword(): void {
  ensureDataDir()
  if (!fs.existsSync(PASSWORD_FILE)) {
    const hashedPassword = md5(DEFAULT_PASSWORD)
    fs.writeFileSync(PASSWORD_FILE, hashedPassword, 'utf-8')
    console.log('[Auth] Password file created with default password')
  }
}

/**
 * Ensure password file exists (recreate if deleted)
 */
function ensurePasswordFile(): void {
  ensureDataDir()
  if (!fs.existsSync(PASSWORD_FILE)) {
    const hashedPassword = md5(DEFAULT_PASSWORD)
    fs.writeFileSync(PASSWORD_FILE, hashedPassword, 'utf-8')
    console.log('[Auth] Password file was missing, recreated with default password')
  }
}

/**
 * Get stored password hash - always ensures file exists first
 */
export function getStoredPasswordHash(): string {
  ensurePasswordFile()
  try {
    const content = fs.readFileSync(PASSWORD_FILE, 'utf-8')
    // Trim whitespace and newlines that might cause comparison failures
    return content.trim().toLowerCase()
  } catch (error) {
    // If read fails, recreate the file
    console.warn('[Auth] Failed to read password file, recreating with default')
    const hashedPassword = md5(DEFAULT_PASSWORD)
    fs.writeFileSync(PASSWORD_FILE, hashedPassword, 'utf-8')
    return hashedPassword
  }
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return false
  const storedHash = getStoredPasswordHash()
  const inputHash = md5(password)
  return inputHash === storedHash
}

/**
 * Update password (stores new MD5 hash)
 */
export function updatePassword(newPassword: string): boolean {
  try {
    ensureDataDir()
    const hashedPassword = md5(newPassword)
    // Write without trailing newline to avoid comparison issues
    fs.writeFileSync(PASSWORD_FILE, hashedPassword, 'utf-8')
    console.log('[Auth] Password updated successfully')
    return true
  } catch (error) {
    console.error('[Auth] Failed to update password:', error)
    return false
  }
}

/**
 * Generate a session token
 */
export function generateSessionToken(): string {
  const token = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  sessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
  })
  return token
}

/**
 * Verify a session token
 */
export function verifySession(token: string): boolean {
  if (!token || typeof token !== 'string') return false
  const session = sessions.get(token)
  if (!session) return false
  if (Date.now() > session.expiresAt) {
    sessions.delete(token)
    return false
  }
  // Refresh session
  session.expiresAt = Date.now() + SESSION_TTL
  return true
}

/**
 * Destroy a session token
 */
export function destroySession(token: string): void {
  sessions.delete(token)
}

/**
 * Clean up expired sessions
 */
export function cleanupSessions(): void {
  const now = Date.now()
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token)
    }
  }
}

// Periodic cleanup and password file check
setInterval(() => {
  cleanupSessions()
  ensurePasswordFile()
}, 60 * 60 * 1000) // Every hour
