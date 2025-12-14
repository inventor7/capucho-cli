import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import fs from 'fs-extra'
import path from 'path'

export default class VersionSync extends Command {
  static description = 'Sync version from package.json to environment files'

  static flags = {
    environment: Flags.string({
      char: 'e',
      description: 'Target environment (dev, staging, prod)',
      required: false,
    }),
    bump: Flags.boolean({
      char: 'b',
      description: 'Bump version code',
      default: false,
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
    const version = packageJson.version

    // Read or create version-code.json
    const versionCodePath = path.join(root, 'version-code.json')
    let versionCodes: Record<string, number> = {dev: 1, staging: 1, prod: 1}

    if (await fs.pathExists(versionCodePath)) {
      versionCodes = await fs.readJson(versionCodePath)
    }

    // Env file mappings - TODO: Make this configurable? For now hardcoded to match legacy
    const envFiles: Record<string, string> = {
      dev: path.join(root, 'build/dev/.env.dev'),
      staging: path.join(root, 'build/staging/.env.staging'),
      prod: path.join(root, 'build/prod/.env.prod'),
    }

    const targetEnvs = flags.environment ? [flags.environment] : Object.keys(envFiles)

    this.log(`\n📦 Syncing version: ${version}\n`)

    for (const env of targetEnvs) {
      const envPath = envFiles[env]
      if (!envPath) {
        this.warn(`Unknown environment: ${env}`)
        continue
      }

      if (!(await fs.pathExists(envPath))) {
        this.warn(`⚠ File not found: ${envPath}`)
        continue
      }

      let content = await fs.readFile(envPath, 'utf8')

      // Increment version code if bumping
      if (flags.bump) {
        versionCodes[env] = (versionCodes[env] || 0) + 1
      }

      const versionCode = versionCodes[env]

      // Replace logic
      if (content.includes('VITE_APP_VERSION=')) {
        content = content.replace(/VITE_APP_VERSION=.*/g, `VITE_APP_VERSION=${version}`)
      }
      if (content.includes('VERSION_CODE=')) {
        content = content.replace(/VERSION_CODE=.*/g, `VERSION_CODE=${versionCode}`)
      }
      if (content.includes('BUILD_NUMBER=')) {
        content = content.replace(/BUILD_NUMBER=.*/g, `BUILD_NUMBER=${versionCode}`)
      }

      await fs.writeFile(envPath, content)
      this.log(`  ✓ ${path.basename(envPath)}: v${version} (code: ${versionCode})`)
    }

    // Save version codes
    await fs.writeJson(versionCodePath, versionCodes, {spaces: 2})
    this.log(`\n✓ Version codes saved to version-code.json\n`)
  }
}
