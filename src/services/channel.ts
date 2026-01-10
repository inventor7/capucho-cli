import axios from 'axios'
import {ConfigManager} from '../utils/config.js'

export class ChannelService {
  private configManager: ConfigManager

  constructor(root: string) {
    this.configManager = new ConfigManager(root)
  }

  async getChannels(env?: string): Promise<string[]> {
    const config = await this.configManager.loadConfig({environment: env})
    const endpoint = config.endpoint || config.VITE_UPDATE_API_URL
    const apiKey = config.apiKey

    if (!endpoint || !apiKey) {
      return ['dev', 'staging', 'prod']
    }

    try {
      // Placeholder API call - adjust to real endpoint
      const response = await axios.get(`${endpoint}/api/channel`, {
        headers: {Authorization: `Bearer ${apiKey}`},
        validateStatus: () => true,
      })

      if (response.status === 200 && Array.isArray(response.data)) {
        // Assuming API returns array of channel objects or strings
        return response.data.map((c: any) => (typeof c === 'string' ? c : c.name))
      }
    } catch {
      // Silent fail to default
    }

    return ['development', 'staging', 'production']
  }
}
