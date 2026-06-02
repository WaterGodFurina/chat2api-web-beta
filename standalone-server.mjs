#!/usr/bin/env node
/**
 * Chat2API Standalone Entry Point
 * For use with Node.js 24+ directly (no Electron required)
 */

import { storeManager } from './main/store/store.js'
import proxyApiRoutes from './main/proxy/routes.js'
import managementRoutes from './main/proxy/routes/management.js'
import { proxyStatusManager } from './main/proxy/status.js'
import { sessionManager } from './main/proxy/sessionManager.js'

import Koa from 'koa'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import serve from 'koa-static'
import * as path from 'path'
import * as fs from 'fs'

const DEFAULT_WEB_PORT = 8080
const DEFAULT_PROXY_PORT = 8080

// Find static files directory
function findStaticDir() {
  const dirs = [
    path.resolve(process.cwd(), 'dist', 'renderer'),
    path.resolve(__dirname, '..', 'dist', 'renderer'),
    process.env.WEB_STATIC_DIR,
  ].filter(Boolean)

  for (const dir of dirs) {
    try {
      const index = path.join(dir, 'index.html')
      if (fs.existsSync(index)) {
        return dir
      }
    } catch {}
  }
  return ''
}

async function main() {
  console.log('========================================')
  console.log('  Chat2API Web Server v1.3.0')
  console.log('  Standalone Mode')
  console.log('========================================\n')

  const webPort = parseInt(process.env.WEB_PORT || String(DEFAULT_WEB_PORT), 10)
  const proxyPort = parseInt(process.env.PROXY_PORT || String(DEFAULT_PROXY_PORT), 10)
  const host = process.env.WEB_HOST || '0.0.0.0'
  const staticDir = findStaticDir()

  console.log(`Configuration:`)
  console.log(`  Static dir: ${staticDir || '(not found)'}`)
  console.log(`  Web port:   ${webPort}`)
  console.log(`  Proxy port: ${proxyPort}\n`)

  // Initialize store
  await storeManager.initialize()

  // Create server
  const app = new Koa()
  
  // Middleware
  app.use(bodyParser())

  // Health check
  app.use(async (ctx, next) => {
    if (ctx.path === '/health') {
      ctx.body = { status: 'ok', timestamp: Date.now() }
      return
    }
    await next()
  })

  // Serve static files
  if (staticDir) {
    app.use(serve(staticDir))
  }

  // Mount routes
  // Management API
  const managementRouter = new Router()
  managementRoutes(managementRouter)
  app.use(managementRouter.routes())
  app.use(managementRouter.allowedMethods())

  // Proxy API
  const proxyRouter = new Router()
  proxyApiRoutes(proxyRouter)
  app.use(proxyRouter.routes())
  app.use(proxyRouter.allowedMethods())

  // Start server
  app.listen(webPort, host, () => {
    console.log(`✓ Chat2API Web Server running on http://${host}:${webPort}`)
    console.log(`✓ API endpoint: http://${host}:${webPort}/v1`)
    console.log(`✓ Management API: http://${host}:${webPort}/v0/management`)
    if (staticDir) {
      console.log(`✓ Web UI: http://${host}:${webPort}/`)
    }
  })
}

main().catch(console.error)
