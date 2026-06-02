import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import http from 'http'
import { PassThrough } from 'stream'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Initialize store first
// ---------------------------------------------------------------------------
import { storeManager } from '../main/store/store'
import { IpcChannels } from '../main/ipc/channels'
import { setBroadcastEvent, BrowserWindow } from './electron-shims'

// Mock mainWindow for handlers - create a real BrowserWindow instance
// so that BrowserWindow.getAllWindows() returns it and CONFIG_CHANGED events work
const mockMainWindow = new BrowserWindow()

// Import IPC handlers logic
import { registerIpcHandlers } from '../main/ipc/handlers'

// Import password manager
import {
  initPassword,
  verifyPassword,
  updatePassword,
  generateSessionToken,
  verifySession,
  destroySession,
} from './auth/passwordManager'

// SSE clients for events
const sseClients = new Set<any>()

function broadcastEvent(channel: string, data: any) {
  const payload = JSON.stringify({ channel, data })
  sseClients.forEach(client => {
    client.write(`data: ${payload}\n\n`)
  })
}

// Set the broadcast function in electron-shims so BrowserWindow.webContents.send works
setBroadcastEvent(broadcastEvent)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_WEB_PORT = 3000

function findStaticDir(): string {
  const dirs = [
    path.resolve(__dirname, '..', 'dist', 'renderer'),
    path.resolve(process.cwd(), 'dist', 'renderer'),
    path.resolve(process.cwd(), 'src', 'renderer', 'dist'),
    path.resolve(process.cwd(), 'renderer', 'dist'),
    process.env.WEB_STATIC_DIR || '',
  ].filter(Boolean)

  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const index = path.join(dir, 'index.html')
        if (fs.existsSync(index)) return dir
      }
    } catch { /* skip */ }
  }
  return ''
}

/**
 * Helper: Read request body as JSON
 */
function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Helper: Send JSON response
 */
function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

/**
 * Extract session token from request
 */
function extractSessionToken(req: http.IncomingMessage): string | null {
  // Check Authorization header
  const authHeader = req.headers['authorization']
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim()
    }
    return authHeader.trim()
  }
  // Check cookie
  const cookieHeader = req.headers['cookie']
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/session_token=([^;]+)/)
    if (match) return match[1]
  }
  return null
}

/**
 * Check if request is authenticated
 */
function isAuthenticated(req: http.IncomingMessage): boolean {
  const token = extractSessionToken(req)
  if (!token) return false
  return verifySession(token)
}

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/check',
  '/health',
  '/api/events',
]

// ---------------------------------------------------------------------------
// Native Node.js Server Implementation (No Koa)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('========================================')
  console.log('  Chat2API Native Server v1.3.0')
  console.log('========================================')

  const staticDir = findStaticDir()
  const webPort = parseInt(process.env.WEB_PORT || process.env.PORT || String(DEFAULT_WEB_PORT))

  console.log(`  Static dir: ${staticDir || 'NOT FOUND'}`)
  console.log(`  Web port:   ${webPort}`)

  console.log('\n[Init] Initializing store...')
  await storeManager.initialize()

  // Initialize password file
  initPassword()

  // Register Electron IPC Handlers for the bridge
  registerIpcHandlers(mockMainWindow)

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const pathname = url.pathname

    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Management-Secret, X-Requested-With')

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    // 2. Auth endpoints (always accessible)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const { password } = body
        if (!password) {
          sendJson(res, 400, { success: false, error: 'Password is required' })
          return
        }
        if (verifyPassword(password)) {
          const token = generateSessionToken()
          // Set cookie
          res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`)
          sendJson(res, 200, { success: true, data: { token } })
        } else {
          sendJson(res, 401, { success: false, error: 'Invalid password' })
        }
      } catch (e: any) {
        sendJson(res, 500, { success: false, error: e.message })
      }
      return
    }

    if (pathname === '/api/auth/check' && req.method === 'GET') {
      const token = extractSessionToken(req)
      const authenticated = token ? verifySession(token) : false
      sendJson(res, 200, { success: true, data: { authenticated } })
      return
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = extractSessionToken(req)
      if (token) {
        destroySession(token)
      }
      res.setHeader('Set-Cookie', 'session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
      sendJson(res, 200, { success: true, data: { message: 'Logged out' } })
      return
    }

    if (pathname === '/api/auth/change-password' && req.method === 'POST') {
      // Require authentication to change password
      if (!isAuthenticated(req)) {
        sendJson(res, 401, { success: false, error: 'Authentication required' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const { currentPassword, newPassword } = body
        if (!currentPassword || !newPassword) {
          sendJson(res, 400, { success: false, error: 'Current password and new password are required' })
          return
        }
        if (!verifyPassword(currentPassword)) {
          sendJson(res, 401, { success: false, error: 'Current password is incorrect' })
          return
        }
        if (newPassword.length < 1) {
          sendJson(res, 400, { success: false, error: 'New password must not be empty' })
          return
        }
        const success = updatePassword(newPassword)
        if (success) {
          sendJson(res, 200, { success: true, data: { message: 'Password updated successfully' } })
        } else {
          sendJson(res, 500, { success: false, error: 'Failed to update password' })
        }
      } catch (e: any) {
        sendJson(res, 500, { success: false, error: e.message })
      }
      return
    }

    // 3. SSE Endpoint - require authentication
    if (pathname === '/api/events' && req.method === 'GET') {
      // SSE endpoint: check auth via query param or cookie
      const token = url.searchParams.get('token') || extractSessionToken(req)
      if (!token || !verifySession(token)) {
        sendJson(res, 401, { success: false, error: 'Authentication required' })
        return
      }
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      const stream = new PassThrough()
      stream.pipe(res)
      sseClients.add(stream)
      req.on('close', () => sseClients.delete(stream))
      return
    }

    // 4. Web Bridge API - require authentication
    if (pathname.startsWith('/api/') && req.method === 'POST') {
      // Check authentication for API endpoints (except auth endpoints already handled above)
      if (!isAuthenticated(req)) {
        sendJson(res, 401, { success: false, error: 'Authentication required' })
        return
      }

      const parts = pathname.split('/').filter(Boolean) // [api, module, action]
      if (parts.length === 3) {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body)
            const channel = `${parts[1]}:${parts[2]}`
            const { getIpcHandler } = await import('./electron-shims')
            const handler = getIpcHandler(channel)
            
            if (handler) {
              // Handle arguments
              let args = []
              if (payload && typeof payload === 'object' && 'args' in payload && Array.isArray(payload.args)) {
                args = payload.args
              } else if (Array.isArray(payload)) {
                args = payload
              } else if (payload !== undefined && Object.keys(payload).length > 0) {
                args = [payload]
              }

              const result = await handler({ sender: mockMainWindow.webContents }, ...args)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true, data: result }))
            } else {
              res.statusCode = 404
              res.end(JSON.stringify({ success: false, error: 'Handler not found' }))
            }
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
        return
      }
    }

    // 5. Health Check
    if (pathname === '/health') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ status: 'ok', mode: 'native' }))
      return
    }

    // 6. Static Files (SPA Fallback)
    if (staticDir) {
      let filePath = path.join(staticDir, pathname === '/' ? 'index.html' : pathname)
      
      // Safety check: ensure file is within staticDir
      const resolvedFilePath = path.resolve(filePath)
      const resolvedStaticDir = path.resolve(staticDir)
      
      if (!resolvedFilePath.startsWith(resolvedStaticDir)) {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }

      fs.stat(resolvedFilePath, (err, stats) => {
        if (err || !stats.isFile()) {
          // Fallback to index.html for SPA
          filePath = path.join(staticDir, 'index.html')
        } else {
          filePath = resolvedFilePath
        }
        
        const ext = path.extname(filePath).toLowerCase()
        const mimeTypes: any = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.wasm': 'application/wasm'
        }
        
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    } else {
      res.statusCode = 404
      res.end('Not Found')
    }
  })

  server.listen(webPort, '0.0.0.0', () => {
    console.log(`\n[Ready] Native Server is running at http://0.0.0.0:${webPort}`)
    console.log('========================================\n')

    // Auto-start proxy if configured
    const config = storeManager.getConfig()
    if (config.autoStartProxy) {
      console.log('[AutoStart] Auto-start proxy is enabled, starting proxy server...')
      import('./electron-shims').then(({ getIpcHandler }) => {
        const startHandler = getIpcHandler('proxy:start')
        if (startHandler) {
          startHandler({ sender: mockMainWindow.webContents })
            .then((result: boolean) => {
              if (result) {
                console.log('[AutoStart] Proxy server started successfully')
              } else {
                console.warn('[AutoStart] Proxy server failed to start')
              }
            })
            .catch((err: any) => {
              console.error('[AutoStart] Proxy server start error:', err.message)
            })
        }
      }).catch((err: any) => {
        console.error('[AutoStart] Failed to load electron-shims:', err.message)
      })
    }
  })
}

main().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
