import axios from 'axios'
import fs from 'fs-extra'
import path from 'node:path'

import {ConfigManager} from '../utils/config.js'

export interface CloudChannel {
  created_at: string
  id: string
  name: string
  public: boolean
  environment: 'prod' | 'staging' | 'dev'
}

export interface CloudFlavor {
  id: string
  name: string
  // Add other flavor properties as needed
}

export interface CloudProjectConfig {
  channels: CloudChannel[]
  flavors: CloudFlavor[]
}

const CACHE_FILE = 'cloud-cache.json'

export class CloudConfigService {
  private configManager: ConfigManager
  private cachePath: string

  constructor(root: string) {
    this.configManager = new ConfigManager(root)
    this.cachePath = path.join(this.configManager.getProjectConfigPath(), '..', CACHE_FILE)
  }

  async fetchProjectConfig(): Promise<CloudProjectConfig | null> {
    const config = await this.configManager.loadConfig()
    const endpoint = config.endpoint || config.VITE_UPDATE_API_URL
    const apiKey = config.apiKey

    if (!endpoint || !apiKey) {
      return this.loadCache()
    }

    try {
      // Fetch Config from API
      // Endpoint: /api/project/config (Proposed)
      const response = await axios.get(`${endpoint}/api/project/config`, {
        headers: {Authorization: `Bearer ${apiKey}`},
        validateStatus: () => true,
      })

      if (response.status === 200 && response.data) {
        const cloudConfig = response.data as CloudProjectConfig
        await this.saveCache(cloudConfig)
        return cloudConfig
      }
    } catch {
      // Console warn if needed, but we silently fall back to cache
    }

    return this.loadCache()
  }

  private async saveCache(data: CloudProjectConfig): Promise<void> {
    try {
      await fs.outputJson(this.cachePath, data, {spaces: 2})
    } catch {
      // Ignore cache write errors
    }
  }

  private async loadCache(): Promise<CloudProjectConfig | null> {
    if (await fs.pathExists(this.cachePath)) {
      try {
        return await fs.readJson(this.cachePath)
      } catch {
        // Ignore cache read errors
      }
    }
    return null
  }
}
