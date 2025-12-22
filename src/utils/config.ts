import * as dotenv from 'dotenv'
import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'

export interface CapuchoConfig {
  [key: string]: unknown
  active?: boolean
  apiKey?: string
  appId?: string
  appName?: string
  apps?: Array<{
    app_id: string
    icon_url?: string
    id: string
    name: string
    organization_id: string
    role: string
  }>
  authenticatedAt?: string
  BUILD_NUMBER?: string
  channel?: string
  defaultAppId?: string
  defaultEnvironment?: string
  endpoint?: string
  environment?: string
  environments?: Record<string, {appId: string; channel: string}>
  flavor?: string
  gitTagVersion?: boolean
  note?: string
  organization?: {name: string}
  organizations?: Array<{
    id: string
    name: string
    role: string
    slug: string
  }>
  required?: boolean
  skipAsset?: boolean
  skipBuild?: boolean
  user?: {email: string; id?: string; role?: string}
  version?: string
  VERSION_CODE?: string
  VITE_APP_ID?: string
  VITE_UPDATE_API_URL?: string
  yes?: boolean
}

const CONFIG_DIR_NAME = '.capucho'
const CONFIG_FILE_NAME = 'config.json'

export class ConfigManager {
  private projectRoot: string

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot
  }

  // Get global config path (~/.capucho/config.json)
  public getGlobalConfigPath(): string {
    return path.join(os.homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME)
  }

  // Get project-specific config path (.capucho/project.json)
  // We rename this to project.json for clarity
  public getProjectConfigPath(): string {
    return path.join(this.projectRoot, CONFIG_DIR_NAME, 'project.json')
  }

  // Load configuration with precedence:
  // 1. Flags (passed as arg)
  // 2. Project Config (.capucho/project.json)
  // 3. Global Config (~/.capucho/config.json)
  public async loadConfig(flags: Partial<CapuchoConfig> = {}): Promise<CapuchoConfig> {
    const globalConfig = await this.readJsonFile(this.getGlobalConfigPath())
    const projectConfig = await this.readJsonFile(this.getProjectConfigPath())

    return {
      ...globalConfig,
      ...projectConfig,
      ...flags,
    }
  }

  public async setGlobalConfig(key: string, value: unknown): Promise<void> {
    const configPath = this.getGlobalConfigPath()
    const config = await this.readJsonFile(configPath)
    config[key] = value
    await fs.outputJson(configPath, config, {spaces: 2})
  }

  public async setProjectConfig(key: string, value: unknown): Promise<void> {
    const configPath = this.getProjectConfigPath()
    const config = await this.readJsonFile(configPath)
    config[key] = value
    await fs.outputJson(configPath, config, {spaces: 2})
  }

  // Read a JSON file safely
  private async readJsonFile(filePath: string): Promise<CapuchoConfig> {
    if (await fs.pathExists(filePath)) {
      try {
        return await fs.readJson(filePath)
      } catch {
        console.warn(`Warning: Failed to parse config file at ${filePath}`)
      }
    }

    return {}
  }
}
