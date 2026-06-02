/**
 * Electron Shims for Web Version
 * Provides minimal Electron API compatibility for running without Electron
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Safe storage shim (base64 encoding, no real encryption)
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (text: string): Buffer => Buffer.from(text, 'utf-8'),
  decryptString: (buffer: Buffer): string => buffer.toString('utf-8'),
}

// App shim
export const app = {
  isPackaged: false,
  getPath: (name: string): string => {
    if (name === 'userData' && process.env.CHAT2API_DATA_DIR) {
      return process.env.CHAT2API_DATA_DIR
    }
    const home = os.homedir()
    switch (name) {
      case 'userData':
        return path.join(home, '.chat2api')
      case 'home':
        return home
      case 'appData':
        return process.env.APPDATA || path.join(home, '.chat2api')
      case 'desktop':
        return path.join(home, 'Desktop')
      case 'documents':
        return path.join(home, 'Documents')
      case 'downloads':
        return path.join(home, 'Downloads')
      case 'exe':
        return process.execPath
      default:
        return path.join(home, '.chat2api')
    }
  },
  getAppPath: (): string => {
    return process.cwd()
  },
  getVersion: (): string => '1.3.0',
  getName: (): string => 'chat2api',
  quit: () => process.exit(0),
  isQuitting: false,
  on: () => {},
  once: () => {},
  removeListener: () => {},
}

// Global registry for IPC handlers
if (!(global as any).ipcHandlers) {
  (global as any).ipcHandlers = {}
}

// ipcMain shim
export const ipcMain = {
  handle: (channel: string, handler: (...args: any[]) => any) => {
    (global as any).ipcHandlers[channel] = handler
  },
  on: (channel: string, handler: (...args: any[]) => any) => {
    (global as any).ipcHandlers[channel] = handler
  },
  removeHandler: (channel: string) => {
    delete (global as any).ipcHandlers[channel]
  },
}

export const getIpcHandler = (channel: string) => {
  return (global as any).ipcHandlers[channel]
}

// BrowserWindow shim
// We need a reference to the broadcastEvent function from server/index.ts
// This will be set during server initialization
let _broadcastEvent: ((channel: string, data: any) => void) | null = null

export function setBroadcastEvent(fn: (channel: string, data: any) => void) {
  _broadcastEvent = fn
}

// Track all "windows" so getAllWindows works
const allWindows: BrowserWindow[] = []

export class BrowserWindow {
  webContents = {
    send: (channel: string, data: any) => {
      // Broadcast via SSE to web clients
      if (_broadcastEvent) {
        _broadcastEvent(channel, data)
      }
    }
  }
  constructor() {
    allWindows.push(this)
  }
  loadURL() {}
  loadFile() {}
  show() {}
  hide() {}
  close() {}
  maximize() {}
  minimize() {}
  on() { return this }
  once() { return this }
  focus() {}
  isMinimized() { return false }
  isDestroyed() { return false }
  restore() {}

  static getAllWindows(): BrowserWindow[] {
    return allWindows
  }
}

// Shell shim
export const shell = {
  openExternal: async (url: string): Promise<void> => {
    const { exec } = await import('child_process')
    const platform = process.platform
    if (platform === 'darwin') {
      exec(`open "${url}"`)
    } else if (platform === 'win32') {
      exec(`start "" "${url}"`)
    } else {
      exec(`xdg-open "${url}"`)
    }
  },
  openPath: async (filePath: string): Promise<void> => {
    const { exec } = await import('child_process')
    const platform = process.platform
    if (platform === 'darwin') {
      exec(`open "${filePath}"`)
    } else if (platform === 'win32') {
      exec(`start "" "${filePath}"`)
    } else {
      exec(`xdg-open "${filePath}"`)
    }
  },
}

// net shim (for perplexity adapter - replaces Electron's net.request with Node.js http/https)
export const net = {
  request: (options: any) => {
    const urlStr = options.url || options.href || ''
    const method = options.method || 'GET'
    const isHttps = urlStr.startsWith('https')
    const mod = isHttps ? require('https') : require('http')
    
    const url = new URL(urlStr)
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {},
    }
    
    const req = mod.request(reqOptions)
    
    const result: any = {
      _req: req,
      _headers: {} as Record<string, string>,
      setHeader: (name: string, value: string) => {
        result._headers[name] = value
      },
      on: (event: string, handler: (...args: any[]) => void) => {
        if (event === 'response') {
          req.on('response', (res: any) => {
            // Mimic Electron's response object
            const electronRes = {
              statusCode: res.statusCode,
              headers: res.headers,
              on: res.on.bind(res),
              pipe: res.pipe.bind(res),
              _readableState: res._readableState,
              read: res.read.bind(res),
              setEncoding: res.setEncoding?.bind(res),
              destroy: res.destroy?.bind(res),
              destroySoon: res.destroySoon?.bind(res),
              statusMessage: res.statusMessage,
            }
            
            result._response = electronRes
            handler(electronRes)
          })
        } else if (event === 'error') {
          req.on('error', handler)
        }
        return result
      },
      end: (data?: any) => {
        if (data) req.write(data)
        if (Object.keys(result._headers).length > 0) {
          for (const [k, v] of Object.entries(result._headers)) {
            req.setHeader(k, v as string)
          }
        }
        req.end()
      },
      write: (data: any) => req.write(data),
      abort: () => req.destroy(),
      destroy: () => req.destroy(),
    }
    
    return result
  },
}

// nativeImage stub
export const nativeImage = {
  createFromPath: () => ({ isEmpty: () => true }),
  createEmpty: () => ({ isEmpty: () => true }),
}

// Tray stub
export class Tray {
  constructor() {}
  setToolTip() {}
  setContextMenu() {}
  destroy() {}
  on() { return this }
  setImage() {}
}

// Menu stub
export const Menu = {
  buildFromTemplate: () => ({ popup: () => {} }),
}

// screen stub
export const screen = {
  getPrimaryDisplay: () => ({
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
  }),
  getAllDisplays: () => [],
}

// session stub
export const session = {
  defaultSession: {
    cookies: {
      get: async () => [],
      set: async () => {},
      remove: async () => {},
    },
  },
  fromPartition: () => ({
    cookies: {
      get: async () => [],
      set: async () => {},
      remove: async () => {},
    },
  }),
}

export default {
  safeStorage,
  app,
  shell,
  net,
  BrowserWindow,
  ipcMain,
  nativeImage,
  Tray,
  Menu,
  screen,
  session,
}
