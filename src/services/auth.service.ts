import axios from 'axios'

import {ConfigManager} from '../utils/config.js'

export interface UserProfile {
  apps: Array<{
    app_id: string
    icon_url?: string
    id: string
    name: string
    organization_id: string
    role: string
  }>
  organizations: Array<{
    id: string
    name: string
    role: string
    slug: string
  }>
  user: {
    email: string
    id: string
  }
}

export class AuthService {
  private configManager: ConfigManager

  constructor(root: string = process.cwd()) {
    this.configManager = new ConfigManager(root)
  }

  /**
   * Fetch user profile with organizations and apps from /api/auth/me
   */
  async fetchUserProfile(endpoint: string, apiKey: string): Promise<UserProfile | null> {
    try {
      const response = await axios.get(`${endpoint}/api/auth/me`, {
        headers: {Authorization: `Bearer ${apiKey}`},
        validateStatus: () => true,
      })

      if (response.status === 200 && response.data) {
        return response.data as UserProfile
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Get accessible apps from stored config
   */
  async getAccessibleApps(): Promise<UserProfile['apps']> {
    const config = await this.configManager.loadConfig()
    return (config.apps as UserProfile['apps']) || []
  }

  /**
   * Get organizations from stored config
   */
  async getOrganizations(): Promise<UserProfile['organizations']> {
    const config = await this.configManager.loadConfig()
    return (config.organizations as UserProfile['organizations']) || []
  }

  /**
   * Get stored API key
   */
  async getApiKey(): Promise<string | null> {
    const config = await this.configManager.loadConfig()
    return config.apiKey || null
  }

  /**
   * Get stored endpoint
   */
  async getEndpoint(): Promise<string | null> {
    const config = await this.configManager.loadConfig()
    return config.endpoint || config.VITE_UPDATE_API_URL || null
  }

  /**
   * Verify stored credentials are valid
   */
  async verifyCredentials(): Promise<{valid: boolean; user?: UserProfile['user']}> {
    const endpoint = await this.getEndpoint()
    const apiKey = await this.getApiKey()

    if (!endpoint || !apiKey) {
      return {valid: false}
    }

    const profile = await this.fetchUserProfile(endpoint, apiKey)
    if (profile) {
      return {
        user: profile.user,
        valid: true,
      }
    }

    return {valid: false}
  }
}
