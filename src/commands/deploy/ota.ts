import {Command, Flags} from '@oclif/core'
import inquirer from 'inquirer'
import chalk from 'chalk'
import fs from 'fs-extra'
import path from 'path'
import {ConfigManager} from '../../utils/config.js'
import {runBuildSteps, findLatestZip, uploadFile, runCommand} from '../../utils/deploy-helpers.js'
import VersionBump from '../version/bump.js'
import VersionSync from '../version/sync.js'

export default class DeployOta extends Command {
  static description = 'Deploy an OTA update to your app'

  static examples = [
    '<%= config.bin %> <%= command.id %> -e staging -v patch',
    '<%= config.bin %> <%= command.id %> --environment prod --version minor --note "Critical fix"',
  ]

  static flags = {
    environment: Flags.string({
      char: 'e',
      description: 'Target environment',
      options: ['dev', 'staging', 'prod'],
      required: false,
    }),
    version: Flags.string({
      char: 'v',
      description: 'Version bump type',
      options: ['major', 'minor', 'patch'],
      required: false,
    }),
    channel: Flags.string({
      char: 'c',
      description: 'Release channel',
      required: false,
    }),
    note: Flags.string({
      char: 'n',
      description: 'Release notes',
      required: false,
    }),
    required: Flags.boolean({
      char: 'r',
      description: 'Mark as required update',
      default: true,
      allowNo: true,
    }),
    active: Flags.boolean({
      char: 'a',
      description: 'Activate update immediately',
      default: true,
      allowNo: true,
    }),
    skipBuild: Flags.boolean({
      description: 'Skip build step',
      default: false,
    }),
    skipAsset: Flags.boolean({
      char: 's',
      description: 'Skip asset generation',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompts',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DeployOta)
    const root = process.cwd()
    const configManager = new ConfigManager(root)

    // Load config (flags > legacy env > project config > global config)
    // We pass flags so ConfigManager can find legacy env based on environment flag if present
    const config = await configManager.loadConfig(flags)

    // Interactive prompts if missing critical info
    let env = config.environment || config.defaultEnvironment
    if (!env) {
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'environment',
          message: 'Select environment:',
          choices: ['dev', 'staging', 'prod'],
          default: 'staging',
        },
      ])
      env = answers.environment
    }

    // Resolve channel defaults
    const channelMap: Record<string, string> = {
      dev: 'development',
      staging: 'beta',
      prod: 'stable',
    }
    const channel = config.channel || channelMap[env] || 'production'

    // Config confirm
    if (!flags.yes) {
      this.log(chalk.cyan('-------------------------------------'))
      this.log(`Environment: ${chalk.green(env)}`)
      this.log(`Channel:     ${chalk.green(channel)}`)
      this.log(`Version Bump:${chalk.green(flags.version || 'none')}`)
      this.log(chalk.cyan('-------------------------------------'))

      const {confirm} = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Ready to deploy?',
          default: true,
        },
      ])
      if (!confirm) return
    }

    try {
      // Step 0: Version Bump
      if (flags.version) {
        // Re-run loadConfig after bumping? Handled by sync command inside bump.
        // Using runCommand helper to invoke bump command logic
        // But since VersionBump is an Oclif command, we can run it.
        // However, arguments passing to run() is specific.
        // Easier to just use our own helpers or shell out if we want clean separation.
        // Let's shell out to ensure clean state or just use the logic directly.
        // Actually, `npm version` is all we really need + sync.

        // Replicating `deploy.js` logic which calls `npm version ...`
        console.log(chalk.magenta(`[0] Bumping version (${flags.version})...`))
        runCommand(`npm version ${flags.version} --no-git-tag-version`, root)
      }

      // Step 1: Sync Version
      console.log(chalk.green('[1] Syncing version to env files...'))
      // We can run the sync command directly
      await VersionSync.run(['--environment', env, ...(flags.version ? ['--bump'] : [])])

      // RELOAD config to get new version codes from .env files (via ConfigManager legacy loader)
      const freshConfig = await configManager.loadConfig({...flags, environment: env})
      const appVersion = (await fs.readJson(path.join(root, 'package.json'))).version
      // The VERSION_CODE should be in freshConfig if it parsed the env file correctly.
      // Legacy deploy script reads it from .env. Let's assume ConfigManager loaded it.
      const versionCode = freshConfig.VERSION_CODE || freshConfig.BUILD_NUMBER || '0'
      const apiUrl = freshConfig.VITE_UPDATE_API_URL || freshConfig.endpoint

      if (!apiUrl) {
        this.error('API URL not found in configuration or .env files!', {exit: 1})
      }

      // App ID logic
      const appIdMap: Record<string, string> = {
        dev: 'io.aybinv7.vuena.dev',
        staging: 'io.aybinv7.vuena.staging',
        prod: 'io.aybinv7.vuena',
      }
      const appId = config.appId
        ? config.environments?.[env]?.appId || `${config.appId}${env === 'prod' ? '' : '.' + env}`
        : appIdMap[env]

      this.log('')
      this.log(chalk.cyan(`Deploying v${appVersion} (${versionCode}) to ${env}...`))
      this.log('')

      // Build Steps (1.5 - 4)
      if (!flags.skipBuild) {
        await runBuildSteps(
          {
            env,
            platform: 'android', // Defaulting to android as per legacy script
            type: 'ota',
            skipAsset: flags.skipAsset,
            required: flags.required,
            active: flags.active,
          },
          root,
        )
      }

      // Step 5: Bundle (OTA specific)
      console.log(chalk.green('[5] Creating OTA bundle...'))
      // Using npx @capgo/cli directly
      runCommand(`npx @capgo/cli bundle zip ${appId} --bundle ${appVersion} --json`, root, true)

      const zipFile = findLatestZip(root)
      if (!zipFile) {
        this.error('Bundle zip not created!')
      }
      this.log(chalk.gray(`  Bundle: ${zipFile.name}`))

      // Step 6: Upload
      console.log(chalk.green('[6] Uploading OTA bundle...'))
      const uploadUrl = `${apiUrl}/api/admin/upload`

      const result = await uploadFile(
        uploadUrl,
        zipFile.path,
        {
          fileField: 'bundle',
          fields: {
            version: appVersion,
            platform: 'android', // TODO: Make configurable
            channel: channel,
            environment: env,
            required: flags.required.toString(),
            active: flags.active.toString(),
            release_notes: flags.note,
          },
        },
        freshConfig.apiKey,
      )

      if (result.success || (result.data && result.data.success)) {
        // Handle bad status but success body
        this.log(chalk.green(`  Upload successful!`))
        fs.unlinkSync(zipFile.path)
        this.log(chalk.gray(`  Cleaned up: ${zipFile.name}`))
      } else {
        this.error(`Upload failed! HTTP ${result.status} - ${JSON.stringify(result.data)}`)
      }
    } catch (error: any) {
      this.error(error.message)
    }
  }
}
