/**
 * File-based JSON Store
 * Replaces electron-store for the web version
 * Stores data as JSON files in a configurable directory
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export class FileStore {
  private data: Record<string, unknown> = {}
  private filePath: string
  private initialized = false

  constructor(options?: { name?: string; cwd?: string }) {
    const cwd = options?.cwd || process.env.CHAT2API_DATA_DIR || path.join(os.homedir(), '.chat2api')
    const name = options?.name || 'data'
    
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true })
    }
    
    this.filePath = path.join(cwd, `${name}.json`)
    this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8')
        this.data = JSON.parse(content)
      } else {
        this.data = {}
        this.save()
      }
    } catch (err) {
      console.error('[FileStore] Failed to load data:', err)
      this.data = {}
    }
    this.initialized = true
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[FileStore] Failed to save data:', err)
    }
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.data[key] as T) ?? defaultValue
  }

  set<T>(key: string, value: T): void {
    this.data[key] = value
    this.save()
  }

  delete(key: string): void {
    delete this.data[key]
    this.save()
  }

  clear(): void {
    this.data = {}
    this.save()
  }

  has(key: string): boolean {
    return key in this.data
  }

  getPath(): string {
    return this.filePath
  }

  get all(): Record<string, unknown> {
    return { ...this.data }
  }
}

export default FileStore
