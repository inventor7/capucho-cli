import axios, {AxiosInstance} from 'axios'
import fs from 'fs-extra'
import path from 'node:path'
import {ConfigManager} from '../utils/config.js'
import {CloudApp, CloudChannel, CloudOrganization, ProjectConfig} from '../types/cloud.js'

export class CloudService {
  private configManager: ConfigManager
  private client: AxiosInstance | null = null
  private root: string

  constructor(root: string = process.cwd()) {
    this.root = root
    this.configManager = new ConfigManager(root)
  }

  private async getClient(): Promise<AxiosInstance> {
    if (this.client) return this.client

    const config = await this.configManager.loadConfig()
    const endpoint = config.endpoint as string
    const apiKey = config.apiKey as string

    if (!endpoint || !apiKey) {
      throw new Error('Not authenticated. Please run: capucho auth login')
    }

    this.client = axios.create({
      baseURL: endpoint,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    })

    return this.client
  }

  async getProjectConfig(): Promise<ProjectConfig | null> {
    const configPath = path.join(this.root, '.capucho', 'project.json')
    if (!(await fs.pathExists(configPath))) return null

    try {
      return await fs.readJson(configPath)
    } catch {
      return null
    }
  }

  async requireProjectConfig(): Promise<ProjectConfig> {
    const config = await this.getProjectConfig()
    if (!config) {
      throw new Error('Project not initialized. Please run: capucho init')
    }
    return config
  }

  async createApp(data: {name: string; app_id: string; platform: string; organization_id: string}): Promise<CloudApp> {
    const client = await this.getClient()
    // Backend expects app_id, not bundle_id
    const response = await client.post('/api/apps', data)
    return response.data
  }

  async getOrganizations(): Promise<CloudOrganization[]> {
    const client = await this.getClient()
    const response = await client.get('/api/organizations')
    return response.data
  }

  async getApps(): Promise<CloudApp[]> {
    const client = await this.getClient()
    const response = await client.get('/api/apps')
    return response.data
  }

  async getChannels(appId: string): Promise<CloudChannel[]> {
    const client = await this.getClient()
    const response = await client.get(`/api/apps/${appId}/channels`)
    return response.data
  }

  async getReleases(appId: string, channel?: string): Promise<any[]> {
    const client = await this.getClient()
    const params = channel ? {channel} : {}
    const response = await client.get(`/api/apps/${appId}/releases`, {params})
    return response.data
  }

  async validateChannel(appId: string, channelName: string): Promise<boolean> {
    const channels = await this.getChannels(appId)
    return channels.some((c) => c.name === channelName)
  }
}
