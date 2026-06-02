import { IpcChannels } from '../../main/ipc/channels'

const API_BASE = '/api'

/**
 * Get the session token from localStorage
 */
function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('session_token')
}

async function fetchApi(channel: string, ...args: any[]) {
  // Convert channel to path: 'proxy:start' -> '/proxy/start'
  const path = channel.replace(':', '/')
  const token = getSessionToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const response = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ args }),
  })
  
  if (response.status === 401) {
    // Session expired, redirect to login
    localStorage.removeItem('session_token')
    window.location.href = '/login'
    throw new Error('Session expired, please login again')
  }
  
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`API Error (${channel}):`, errorText)
    throw new Error(`API request failed: ${response.status}`)
  }
  
  const result = await response.json()
  return result.success ? result.data : result.error
}

// Map of event listeners
const listeners = new Map<string, Set<(...args: any[]) => void>>()

// Lazy EventSource - only create when authenticated
let eventSource: EventSource | null = null

function getEventSource(): EventSource | null {
  const token = getSessionToken()
  if (!token) return null
  if (eventSource) return eventSource
  
  eventSource = new EventSource(`${API_BASE}/events?token=${encodeURIComponent(token)}`)
  eventSource.onerror = () => {
    // If SSE fails due to auth, redirect to login
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }
  eventSource.onmessage = (event) => {
    try {
      const { channel, data } = JSON.parse(event.data)
      const channelListeners = listeners.get(channel)
      if (channelListeners) {
        channelListeners.forEach(callback => callback(data))
      }
    } catch (error) {
      console.error('Failed to parse event data:', error)
    }
  }
  return eventSource
}

// Initialize EventSource when token is available
function initEventSource() {
  const token = getSessionToken()
  if (token && !eventSource) {
    getEventSource()
  }
}

// Try to init on load
if (typeof window !== 'undefined') {
  initEventSource()
}

export const webAPI = {
  // Auth APIs
  auth: {
    login: async (password: string): Promise<{ token: string } | null> => {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const result = await response.json()
      if (result.success && result.data?.token) {
        localStorage.setItem('session_token', result.data.token)
        initEventSource()
        return result.data
      }
      throw new Error(result.error || 'Login failed')
    },
    check: async (): Promise<boolean> => {
      const token = getSessionToken()
      if (!token) return false
      try {
        const response = await fetch(`${API_BASE}/auth/check`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const result = await response.json()
        return result.success && result.data?.authenticated === true
      } catch {
        return false
      }
    },
    logout: async (): Promise<void> => {
      const token = getSessionToken()
      if (token) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        })
      }
      localStorage.removeItem('session_token')
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    },
    changePassword: async (currentPassword: string, newPassword: string): Promise<any> => {
      const token = getSessionToken()
      const response = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to change password')
      }
      return result.data
    },
  },

  // Common utilities
  on: (channel: string, callback: (...args: any[]) => void) => {
    // Avoid double listeners in React StrictMode
    if (!listeners.has(channel)) {
      listeners.set(channel, new Set())
    }
    const set = listeners.get(channel)!
    set.add(callback)
    // Ensure EventSource is running
    initEventSource()
    return () => {
      set.delete(callback)
    }
  },
  send: (channel: string, ...args: any[]) => {
    fetchApi(channel, ...args).catch(err => {
      // Quiet fail for background syncs to avoid UI crashes
      if (channel !== IpcChannels.PROVIDERS_CHECK_ALL_STATUS) {
        console.error(`Send to ${channel} failed:`, err)
      }
    })
  },
  invoke: (channel: string, ...args: any[]) => fetchApi(channel, ...args),

  // Specific APIs
  proxy: {
    start: (port?: number) => fetchApi(IpcChannels.PROXY_START, port),
    stop: () => fetchApi(IpcChannels.PROXY_STOP),
    getStatus: () => fetchApi(IpcChannels.PROXY_GET_STATUS),
    onStatusChanged: (callback: (status: any) => void) => webAPI.on(IpcChannels.PROXY_STATUS_CHANGED, callback),
  },

  store: {
    get: (key: string) => fetchApi(IpcChannels.STORE_GET, key),
    set: (key: string, value: any) => fetchApi(IpcChannels.STORE_SET, key, value),
    delete: (key: string) => fetchApi(IpcChannels.STORE_DELETE, key),
    clearAll: () => fetchApi(IpcChannels.STORE_CLEAR_ALL),
  },

  providers: {
    getAll: () => fetchApi(IpcChannels.PROVIDERS_GET_ALL),
    getBuiltin: () => fetchApi(IpcChannels.PROVIDERS_GET_BUILTIN),
    add: (data: any) => fetchApi(IpcChannels.PROVIDERS_ADD, data),
    update: (id: string, updates: any) => fetchApi(IpcChannels.PROVIDERS_UPDATE, id, updates),
    delete: (id: string) => fetchApi(IpcChannels.PROVIDERS_DELETE, id),
    checkStatus: (providerId: string) => fetchApi(IpcChannels.PROVIDERS_CHECK_STATUS, providerId),
    checkAllStatus: () => fetchApi(IpcChannels.PROVIDERS_CHECK_ALL_STATUS),
    duplicate: (id: string) => fetchApi(IpcChannels.PROVIDERS_DUPLICATE, id),
    export: (id: string) => fetchApi(IpcChannels.PROVIDERS_EXPORT, id),
    import: (jsonData: string) => fetchApi(IpcChannels.PROVIDERS_IMPORT, jsonData),
    updateModels: (providerId: string) => fetchApi(IpcChannels.PROVIDERS_UPDATE_MODELS, providerId),
    getEffectiveModels: (providerId: string) => fetchApi(IpcChannels.PROVIDERS_GET_EFFECTIVE_MODELS, providerId),
    addCustomModel: (providerId: string, model: any) => fetchApi(IpcChannels.PROVIDERS_ADD_CUSTOM_MODEL, providerId, model),
    removeModel: (providerId: string, modelName: string) => fetchApi(IpcChannels.PROVIDERS_REMOVE_MODEL, providerId, modelName),
    resetModels: (providerId: string) => fetchApi(IpcChannels.PROVIDERS_RESET_MODELS, providerId),
  },

  accounts: {
    getAll: (includeCredentials?: boolean) => fetchApi(IpcChannels.ACCOUNTS_GET_ALL, includeCredentials),
    add: (data: any) => fetchApi(IpcChannels.ACCOUNTS_ADD, data),
    update: (id: string, updates: any) => fetchApi(IpcChannels.ACCOUNTS_UPDATE, id, updates),
    delete: (id: string) => fetchApi(IpcChannels.ACCOUNTS_DELETE, id),
    validate: (accountId: string) => fetchApi(IpcChannels.ACCOUNTS_VALIDATE, accountId),
    validateToken: (providerId: string, credentials: any) => fetchApi(IpcChannels.ACCOUNTS_VALIDATE_TOKEN, providerId, credentials),
    getById: (id: string, includeCredentials?: boolean) => fetchApi(IpcChannels.ACCOUNTS_GET_BY_ID, id, includeCredentials),
    getByProvider: (providerId: string) => fetchApi(IpcChannels.ACCOUNTS_GET_BY_PROVIDER, providerId),
    getCredits: (accountId: string) => fetchApi(IpcChannels.ACCOUNTS_GET_CREDITS, accountId),
    clearChats: (accountId: string) => fetchApi(IpcChannels.ACCOUNTS_CLEAR_CHATS, accountId),
  },

  config: {
    get: () => fetchApi(IpcChannels.CONFIG_GET),
    update: (updates: any) => fetchApi(IpcChannels.CONFIG_UPDATE, updates),
    onConfigChanged: (callback: (config: any) => void) => webAPI.on(IpcChannels.CONFIG_CHANGED, callback),
  },

  logs: {
    get: (filter?: any) => fetchApi(IpcChannels.LOGS_GET, filter),
    getStats: () => fetchApi(IpcChannels.LOGS_GET_STATS),
    getTrend: (days?: number) => fetchApi(IpcChannels.LOGS_GET_TREND, days),
    getAccountTrend: (accountId: string, days?: number) => fetchApi(IpcChannels.LOGS_GET_ACCOUNT_TREND, accountId, days),
    clear: () => fetchApi(IpcChannels.LOGS_CLEAR),
    export: (format?: any) => fetchApi(IpcChannels.LOGS_EXPORT, format),
    getById: (id: string) => fetchApi(IpcChannels.LOGS_GET_BY_ID, id),
    onNewLog: (callback: (log: any) => void) => webAPI.on(IpcChannels.LOGS_NEW_LOG, callback),
  },

  requestLogs: {
    get: (filter?: any) => fetchApi(IpcChannels.REQUEST_LOGS_GET, filter),
    getById: (id: string) => fetchApi(IpcChannels.REQUEST_LOGS_GET_BY_ID, id),
    getStats: () => fetchApi(IpcChannels.REQUEST_LOGS_GET_STATS),
    getTrend: (days?: number) => fetchApi(IpcChannels.REQUEST_LOGS_GET_TREND, days),
    clear: () => fetchApi(IpcChannels.REQUEST_LOGS_CLEAR),
    onNewLog: (callback: (log: any) => void) => webAPI.on(IpcChannels.REQUEST_LOGS_NEW, callback),
  },

  statistics: {
    get: () => fetchApi(IpcChannels.STATISTICS_GET),
    getToday: () => fetchApi(IpcChannels.STATISTICS_GET_TODAY),
  },

  prompts: {
    getAll: () => fetchApi(IpcChannels.PROMPTS_GET_ALL),
    getBuiltin: () => fetchApi(IpcChannels.PROMPTS_GET_BUILTIN),
    getCustom: () => fetchApi(IpcChannels.PROMPTS_GET_CUSTOM),
    getById: (id: string) => fetchApi(IpcChannels.PROMPTS_GET_BY_ID, id),
    add: (prompt: any) => fetchApi(IpcChannels.PROMPTS_ADD, prompt),
    update: (id: string, updates: any) => fetchApi(IpcChannels.PROMPTS_UPDATE, id, updates),
    delete: (id: string) => fetchApi(IpcChannels.PROMPTS_DELETE, id),
  },

  session: {
    getConfig: () => fetchApi(IpcChannels.SESSION_GET_CONFIG),
    updateConfig: (config: any) => fetchApi(IpcChannels.SESSION_UPDATE_CONFIG, config),
    getAll: () => fetchApi(IpcChannels.SESSION_GET_ALL),
    getActive: () => fetchApi(IpcChannels.SESSION_GET_ACTIVE),
    getById: (id: string) => fetchApi(IpcChannels.SESSION_GET_BY_ID, id),
    getByAccount: (accountId: string) => fetchApi(IpcChannels.SESSION_GET_BY_ACCOUNT, accountId),
    getByProvider: (providerId: string) => fetchApi(IpcChannels.SESSION_GET_BY_PROVIDER, providerId),
    delete: (id: string) => fetchApi(IpcChannels.SESSION_DELETE, id),
    clearAll: () => fetchApi(IpcChannels.SESSION_CLEAR_ALL),
    cleanExpired: () => fetchApi(IpcChannels.SESSION_CLEAN_EXPIRED),
  },

  managementApi: {
    getConfig: () => fetchApi(IpcChannels.MANAGEMENT_API_GET_CONFIG),
    updateConfig: (updates: any) => fetchApi(IpcChannels.MANAGEMENT_API_UPDATE_CONFIG, updates),
    generateSecret: () => fetchApi(IpcChannels.MANAGEMENT_API_GENERATE_SECRET),
  },

  toolCalling: {
    getStatus: () => fetchApi(IpcChannels.TOOL_CALLING_GET_STATUS),
    runSmoke: (input: any) => fetchApi(IpcChannels.TOOL_CALLING_RUN_SMOKE, input),
  },

  contextManagement: {
    getConfig: () => fetchApi(IpcChannels.CONTEXT_MANAGEMENT_GET_CONFIG),
    updateConfig: (updates: any) => fetchApi(IpcChannels.CONTEXT_MANAGEMENT_UPDATE_CONFIG, updates),
  },

  app: {
    getVersion: () => fetchApi(IpcChannels.APP_GET_VERSION),
    checkUpdate: () => fetchApi(IpcChannels.APP_CHECK_UPDATE),
    downloadUpdate: () => fetchApi(IpcChannels.APP_DOWNLOAD_UPDATE),
    installUpdate: () => fetchApi(IpcChannels.APP_INSTALL_UPDATE),
    getUpdateStatus: () => fetchApi(IpcChannels.APP_GET_UPDATE_STATUS),
    onUpdateChecking: (callback: any) => webAPI.on(IpcChannels.APP_UPDATE_CHECKING, callback),
    onUpdateAvailable: (callback: any) => webAPI.on(IpcChannels.APP_UPDATE_AVAILABLE, callback),
    onUpdateNotAvailable: (callback: any) => webAPI.on(IpcChannels.APP_UPDATE_NOT_AVAILABLE, callback),
    onUpdateProgress: (callback: any) => webAPI.on(IpcChannels.APP_UPDATE_PROGRESS, callback),
    onUpdateDownloaded: (callback: any) => webAPI.on(IpcChannels.APP_UPDATE_DOWNLOADED, callback),
    onUpdateError: (callback: any) => webAPI.on(IpcChannels.APP_UPDATE_ERROR, callback),
    minimize: () => Promise.resolve(),
    maximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    showWindow: () => Promise.resolve(),
    hideWindow: () => Promise.resolve(),
    openExternal: (url: string) => window.open(url, '_blank'),
  },

  tray: {
    openDashboard: () => {},
    setHeight: () => {},
    quitApp: () => {},
  }
}
