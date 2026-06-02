#!/usr/bin/env node

/**
 * Chat2API Standalone Server
 * This script bundles the server functionality without requiring a full rebuild
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Set environment variables for Docker
process.env.NODE_ENV = process.env.NODE_ENV || 'production'
process.env.WEB_PORT = process.env.WEB_PORT || '8080'
process.env.PROXY_PORT = process.env.PROXY_PORT || '8080'
process.env.WEB_HOST = process.env.WEB_HOST || '0.0.0.0'

console.log('========================================')
console.log('  Chat2API Web Server v1.3.0')
console.log('  Running in standalone mode')
console.log('========================================\n')
console.log(`Configuration:`)
console.log(`  WEB_PORT:    ${process.env.WEB_PORT}`)
console.log(`  PROXY_PORT:  ${process.env.PROXY_PORT}`)
console.log(`  WEB_HOST:    ${process.env.WEB_HOST}`)
console.log('')

// Import and run the actual server
// We'll use dynamic import to avoid build issues
try {
  const serverModule = await import('./src/server/index.ts')
  // If index.ts has a default export, call it
  if (serverModule.default && typeof serverModule.default === 'function') {
    await serverModule.default()
  }
} catch (error) {
  console.error('Failed to start server:', error)
  process.exit(1)
}
