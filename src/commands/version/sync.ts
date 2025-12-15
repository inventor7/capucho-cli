import {Command, Flags} from '@oclif/core'
import fs from 'fs-extra'
import path from 'node:path'

export default class VersionSync extends Command {
  static description = 'Sync version from package.json to environment files'
static flags = {
    bump: Flags.boolean({
      char: 'b',
      default: false,
      description: 'Bump version code',
    }),
    environment: Flags.string({
      char: 'e',
      description: 'Target environment (dev, staging, prod)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(VersionSync)
    const root = process.cwd()

    // Read package.json
    const packageJsonPath = path.join(root, 'package.json')
    if (!(await fs.pathExists(packageJsonPath))) {
      this.error('package.json not found in current directory')
    }

    const packageJson = await fs.readJson(packageJsonPath)
    const {version} = packageJson

    // Read or create version-code.json
    const versionCodePath = path.join(root, 'version-code.json')
    let versionCodes: Record<string, number> = {dev: 1, prod: 1, staging: 1}

    if (await fs.pathExists(versionCodePath)) {
      versionCodes = await fs.readJson(versionCodePath)
    }

    // Env file mappings - TODO: Make this configurable? For now hardcoded to match legacy
    const envFiles: Record<string, string> = {
      dev: path.join(root, 'build/dev/.env.dev'),
      prod: path.join(root, 'build/prod/.env.prod'),
      staging: path.join(root, 'build/staging/.env.staging'),
    }

    const targetEnvs = flags.environment ? [flags.environment] : Object.keys(envFiles)

    this.log(`\n📦 Syncing version: ${version}\n`)

    // Pre-calculate version codes if needed to avoid modifying during async operations
    if (flags.bump) {
      for (const env of targetEnvs) {
        versionCodes[env] = (versionCodes[env] || 0) + 1
      }
    }

    // Process environments sequentially using a recursive approach to satisfy lint rules
    const processEnv = async (index: number): Promise<void> => {
      if (index >= targetEnvs.length) return;

      const env = targetEnvs[index]
      const envPath = envFiles[env]
      if (!envPath) {
        this.warn(`Unknown environment: ${env}`)
        return processEnv(index + 1)
      }

      if (!(await fs.pathExists(envPath))) {
        this.warn(`⚠ File not found: ${envPath}`)
        return processEnv(index + 1)
      }

      let content = await fs.readFile(envPath, 'utf8')

      const versionCode = versionCodes[env]

      // Replace logic
      if (content.includes('VITE_APP_VERSION=')) {
        content = content.replaceAll(/VITE_APP_VERSION=.*/g, `VITE_APP_VERSION=${version}`)
      }

      if (content.includes('VERSION_CODE=')) {
        content = content.replaceAll(/VERSION_CODE=.*/g, `VERSION_CODE=${versionCode}`)
      }

      if (content.includes('BUILD_NUMBER=')) {
        content = content.replaceAll(/BUILD_NUMBER=.*/g, `BUILD_NUMBER=${versionCode}`)
      }

      await fs.writeFile(envPath, content)
      this.log(`  ✓ ${path.basename(envPath)}: v${version} (code: ${versionCode})`)

      return processEnv(index + 1)
    }

    await processEnv(0)

    // Save version codes
    await fs.writeJson(versionCodePath, versionCodes, {spaces: 2})
    this.log(`\n✓ Version codes saved to version-code.json\n`)
  }
}
