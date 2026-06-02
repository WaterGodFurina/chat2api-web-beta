/**
 * Proxy Service Module - Proxy Server Core
 * Implements proxy server based on Native Node.js (No Koa)
 */

import http from 'http'
import { PassThrough } from 'stream'
import routes from './routes'
import managementRoutes from './routes/management'
import { proxyStatusManager } from './status'
import { storeManager } from '../store/store'

/**
 * Native Response Adapter (Mocks Koa Context)
 */
class NativeContext {
  public status: number = 200
  public body: any = null
  public headers: Record<string, string> = {}
  public request: any = { body: {} }

  constructor(public req: http.IncomingMessage, public res: http.ServerResponse, public params: any = {}) {}

  set(name: string, value: string) {
    this.headers[name] = value
    this.res.setHeader(name, value)
  }

  get(name: string) { return this.req.headers[name.toLowerCase()] }

  get path() { return new URL(this.req.url || '', `http://${this.req.headers.host || 'localhost'}`).pathname }
  get method() { return this.req.method }
  get query() { return Object.fromEntries(new URL(this.req.url || '', `http://${this.req.headers.host || 'localhost'}`).searchParams) }
  get ip() { return this.req.socket.remoteAddress }
}

export class ProxyServer {
  private server: http.Server | null = null

  public async start(port: number = 8080, host: string = '0.0.0.0'): Promise<boolean> {
    const _port = port || 8080
    const _host = host || '0.0.0.0'
    
    proxyStatusManager.updateConfig({ port: _port, host: _host })

    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const ctx = new NativeContext(req, res)
        const config = storeManager.getConfig()

        // 1. Priority: Health Check
        if (ctx.path === '/health' || ctx.path === '/stats' || ctx.path === '/') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ status: 'ok', version: '1.3.0-native' }))
          return
        }

        // 2. Authentication Middleware
        if (!ctx.path.startsWith('/v0/management')) {
          if (config.enableApiKey && config.apiKeys && config.apiKeys.length > 0) {
            const authHeader = ctx.get('Authorization') || ''
            const providedKey = authHeader.startsWith('Bearer ') 
              ? authHeader.slice(7) 
              : (ctx.query.api_key as string) || ctx.get('X-API-Key')
            
            const validKey = config.apiKeys.find(k => k.key === providedKey && k.enabled)
            if (!validKey) {
              res.statusCode = 401
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: { message: 'Invalid or missing API key', type: 'invalid_request_error', code: 'invalid_api_key' } }))
              return
            }
            // Store API key info on context for request logging
            ;(ctx as any).apiKeyId = validKey.id
            ;(ctx as any).apiKeyName = validKey.name
            // Update stats
            const updatedKeys = config.apiKeys.map(k => k.id === validKey.id ? { ...k, lastUsedAt: Date.now(), usageCount: k.usageCount + 1 } : k)
            storeManager.updateConfig({ apiKeys: updatedKeys })
          }
        }

        // 3. CORS & Options
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-API-Key, X-Management-Secret')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        // 4. Body Parser
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          const body = await new Promise<string>((resolveBody) => {
            let data = ''
            req.on('data', chunk => data += chunk)
            req.on('end', () => resolveBody(data))
          })
          try { ctx.request.body = JSON.parse(body) } catch { ctx.request.body = {} }
        }

        // 5. Native Router Dispatcher
        const dispatch = async (routerList: any[]) => {
          if (!Array.isArray(routerList)) return false
          const requestPath = ctx.path
          const requestMethod = req.method

          for (const router of routerList) {
            for (const layer of router.stack) {
              if (!layer.methods.includes(requestMethod)) continue

              // AUDIT CONCLUSION: In the original project's @koa/router usage,
              // layer.path ALREADY contains the full prefix-concatenated path.
              // NO additional basePrefix or routerPrefix is needed.
              const fullPath = layer.path.replace(/\/+/g, '/') || '/'
              
              const isExactMatch = requestPath === fullPath
              let isRegexMatch = false
              let matchResult = null
              
              if (!isExactMatch && fullPath.includes(':')) {
                const pattern = '^' + fullPath.replace(/:([^\/]+)/g, '(?<$1>[^/]+)') + '$'
                try {
                  const pathRegex = new RegExp(pattern)
                  matchResult = requestPath.match(pathRegex)
                  isRegexMatch = !!matchResult
                } catch (e) {}
              }

              if (isExactMatch || isRegexMatch) {
                if (isRegexMatch && matchResult && matchResult.groups) {
                  ctx.params = { ...ctx.params, ...matchResult.groups }
                }
                const middleware = layer.stack
                let i = 0
                const next = async () => {
                  if (i < middleware.length) await middleware[i++](ctx, next)
                }
                await next()
                return true
              }
            }
          }
          return false
        }

        try {
          // Both management and proxy routes should be dispatched as-is
          const handled = await dispatch(managementRoutes as any) || await dispatch(routes as any)
          
          if (handled) {
            res.statusCode = ctx.status
            if (ctx.body instanceof PassThrough) {
              ctx.body.pipe(res)
            } else {
              res.setHeader('Content-Type', 'application/json')
              res.end(typeof ctx.body === 'string' ? ctx.body : JSON.stringify(ctx.body))
            }
          } else {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `Not Found: ${ctx.path}` }))
          }
        } catch (err: any) {
          console.error('[Proxy] Runtime Error:', err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })

      this.server.on('error', (err: any) => {
        console.error(`[Proxy] Server error:`, err)
        proxyStatusManager.stop()
        this.server = null
        resolve(false)
      })

      this.server.listen(_port, _host, () => {
        console.log(`[Proxy] Native Server running on ${_host}:${_port}`)
        proxyStatusManager.start()
        resolve(true)
      })
    })
  }

  public async stop(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          proxyStatusManager.stop()
          this.server = null
          resolve(true)
        })
      } else { resolve(true) }
    })
  }
}

export const proxyServer = new ProxyServer()
