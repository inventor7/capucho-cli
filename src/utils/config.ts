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
  authenticatedAt?: string
  BUILD_NUMBER?: string
  channel?: string
  defaultEnvironment?: string
  endpoint?: string
  environment?: string
  environments?: Record<string, {appId: string; channel: string}>
  flavor?: string
  gitTagVersion?: boolean
  note?: string
  organization?: {name: string}
  required?: boolean
  skipAsset?: boolean
  skipBuild?: boolean
  user?: {email: string; role: string}
  version?: string
  VERSION_CODE?: string
  VITE_UPDATE_API_URL?: string
  yes?: boolean
}

const CONFIG_DIR_NAME = '.capucho'
const CONFIG_FILE_NAME = 'config.json'
const LEGACY_ENV_MAP: Record<string, string> = {
  dev: 'build/dev/.env.dev',
  prod: 'build/prod/.env.prod',
  staging: 'build/staging/.env.staging',
}

export class ConfigManager {
  private projectRoot: string

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot
  }

  // Get global config path
  public getGlobalConfigPath(): string {
    return path.join(os.homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME)
  }

  // Get project-specific config path
  public getProjectConfigPath(): string {
    return path.join(this.projectRoot, CONFIG_DIR_NAME, CONFIG_FILE_NAME)
  }

  // Load configuration with precedence:
  // 1. Flags (passed as arg)
  // 2. Legacy .env (if environment flag is set)
  // 3. Project Config
  // 4. Global Config
  public async loadConfig(flags: Partial<CapuchoConfig> = {}): Promise<CapuchoConfig> {
    const globalConfig = await this.readJsonFile(this.getGlobalConfigPath())
    const projectConfig = await this.readJsonFile(this.getProjectConfigPath())

    let legacyConfig = {}
    if (flags.environment) {
      legacyConfig = await this.loadLegacyEnv(flags.environment, flags.flavor)
    }

    // Merge in reverse order of precedence (base is empty)
    return {
      ...globalConfig,
      ...projectConfig,
      ...legacyConfig,
      ...flags, // Flags overwrite everything
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

  // Load legacy .env file based on environment and optional flavor
  private async loadLegacyEnv(env: string, flavor?: string): Promise<CapuchoConfig> {
    let relativePath = LEGACY_ENV_MAP[env]

    if (flavor && relativePath) {
      // Re-route to flavor path: build/flavors/<flavor>/<env>/.env.<env>
      const envFileName = path.basename(relativePath)
      relativePath = path.join('build', 'flavors', flavor, env, envFileName)
    }

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
