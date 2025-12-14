import path from 'path'
import fs from 'fs-extra'
import os from 'os'
import * as dotenv from 'dotenv'

export interface CapuchoConfig {
  apiKey?: string
  appId?: string
  appName?: string
  defaultEnvironment?: string
  environments?: Record<string, {appId: string; channel: string}>
  [key: string]: any
}

const CONFIG_DIR_NAME = '.capucho'
const CONFIG_FILE_NAME = 'config.json'
const LEGACY_ENV_MAP: Record<string, string> = {
  dev: 'build/dev/.env.dev',
  staging: 'build/staging/.env.staging',
  prod: 'build/prod/.env.prod',
}

export class ConfigManager {
  private projectRoot: string

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot
  }

  // Get project-specific config path
  public getProjectConfigPath(): string {
    return path.join(this.projectRoot, CONFIG_DIR_NAME, CONFIG_FILE_NAME)
  }

  // Get global config path
  public getGlobalConfigPath(): string {
    return path.join(os.homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME)
  }

  // Load configuration with precedence:
  // 1. Flags (passed as arg)
  // 2. Legacy .env (if environment flag is set)
  // 3. Project Config
  // 4. Global Config
  public async loadConfig(flags: any = {}): Promise<CapuchoConfig> {
    const globalConfig = await this.readJsonFile(this.getGlobalConfigPath())
    const projectConfig = await this.readJsonFile(this.getProjectConfigPath())

    let legacyConfig = {}
    if (flags.environment) {
      legacyConfig = await this.loadLegacyEnv(flags.environment)
    }

    // Merge in reverse order of precedence (base is empty)
    return {
      ...globalConfig,
      ...projectConfig,
      ...legacyConfig,
      ...flags, // Flags overwrite everything
    }
  }

  // Read a JSON file safely
  private async readJsonFile(filePath: string): Promise<CapuchoConfig> {
    if (await fs.pathExists(filePath)) {
      try {
        return await fs.readJson(filePath)
      } catch (e) {
        console.warn(`Warning: Failed to parse config file at ${filePath}`)
      }
    }
    return {}
  }

  // Load legacy .env file based on environment
  private async loadLegacyEnv(env: string): Promise<CapuchoConfig> {
    const relativePath = LEGACY_ENV_MAP[env]
    if (!relativePath) return {}

    // Check both current dir and parent dir (in case running from cli folder)
    let envPath = path.join(this.projectRoot, relativePath)
    if (!(await fs.pathExists(envPath))) {
      // Try parent directory if we are inside a subfolder (like capucho-cli)
      envPath = path.join(this.projectRoot, '..', relativePath)
    }

    if (await fs.pathExists(envPath)) {
      const envContent = await fs.readFile(envPath, 'utf8')
      const parsed = dotenv.parse(envContent)

      // Map legacy env vars to config keys if needed
      // Currently just returning them as is, but specific keys might need mapping
      const config: CapuchoConfig = {}

      if (parsed.VITE_UPDATE_API_URL) {
        // Can map this to an 'endpoint' config if we want
        // config.endpoint = parsed.VITE_UPDATE_API_URL;
      }

      // We also return the raw parsed env vars so commands can look them up
      return {...config, ...parsed}
    }
    return {}
  }

  public async setGlobalConfig(key: string, value: any): Promise<void> {
    const configPath = this.getGlobalConfigPath()
    const config = await this.readJsonFile(configPath)
    config[key] = value
    await fs.outputJson(configPath, config, {spaces: 2})
  }

  public async setProjectConfig(key: string, value: any): Promise<void> {
    const configPath = this.getProjectConfigPath()
    const config = await this.readJsonFile(configPath)
    config[key] = value
    await fs.outputJson(configPath, config, {spaces: 2})
  }
}
