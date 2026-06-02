/**
 * Proxy Agent Utility
 * Creates axios config with HTTP proxy support from account settings
 */

import { HttpsProxyAgent } from 'https-proxy-agent'
import type { AxiosRequestConfig } from 'axios'

/**
 * Create axios config with HTTP proxy agent based on account's httpProxy setting
 * @param account Account object with optional httpProxy field
 * @param overrides Additional axios config overrides
 * @returns AxiosRequestConfig with proxy agent applied if configured
 */
export function createAxiosConfig(
  httpProxy: string | undefined,
  overrides: AxiosRequestConfig = {}
): AxiosRequestConfig {
  const config: AxiosRequestConfig = { ...overrides }

  if (httpProxy) {
    try {
      const proxyAgent = new HttpsProxyAgent(httpProxy)
      config.httpsAgent = proxyAgent
      config.httpAgent = proxyAgent
    } catch (err) {
      console.warn(`[ProxyAgent] Invalid proxy URL: ${httpProxy}`, err)
    }
  }

  return config
}
