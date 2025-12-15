import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import path from 'node:path'

import {CloudConfigService} from '../../services/cloud-config.js'
import {ConfigManager} from '../../utils/config.js'
import {findLatestZip, runBuildSteps, runCommand, uploadFile} from '../../utils/deploy-helpers.js'
import VersionSync from '../version/sync.js'

export default class DeployOta extends Command {
  static description = 'Deploy an OTA update to your app'
  static examples = [
    '<%= config.bin %> <%= command.id %> -e staging -v patch',
    '<%= config.bin %> <%= command.id %> --environment prod --version minor --note "Critical fix"',
  ]
  static flags = {
    active: Flags.boolean({
      allowNo: true,
      char: 'a',
      default: undefined, // Changed to undefined to allow prompt if missing
      description: 'Activate update immediately',
    }),
    channel: Flags.string({
      char: 'c',
      description: 'Release channel',
      required: false,
    }),
    environment: Flags.string({
      char: 'e',
      description: 'Target environment',
      options: ['dev', 'staging', 'prod'],
      required: false,
    }),
    flavor: Flags.string({
      char: 'f',
      description: 'Client/Flavor name (e.g. clientA)',
    }),
    note: Flags.string({
      char: 'n',
      description: 'Release notes',
      required: false,
    }),
    required: Flags.boolean({
      allowNo: true,
      char: 'r',
      default: undefined,
      description: 'Mark as required update',
    }),
    skipAsset: Flags.boolean({
      char: 's',
      default: false,
      description: 'Skip asset generation',
    }),
    skipBuild: Flags.boolean({
      default: false,
      description: 'Skip build step',
    }),
    version: Flags.string({
      char: 'v',
      description: 'Version bump type',
      options: ['major', 'minor', 'patch'],
      required: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      default: false,
      description: 'Skip confirmation prompts',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DeployOta)
    const root = process.cwd()
    const configManager = new ConfigManager(root)
    const cloudService = new CloudConfigService(root)

    // 1. Fetch Cloud Config (Flavors, Channels)
    // We try to fetch this even if flags are present, unless offline
    const cloudConfig = await cloudService.fetchProjectConfig()

    let {environment, flavor, channel, active, required, note, version} = flags

    // --- Interactive Wizard (Cloud-First) ---

    // A. Flavor Selection
    if (!flavor) {
      // Check if we have flavors in cloud config
      const cloudFlavors = cloudConfig?.flavors?.map((f) => f.name) || []

      if (cloudFlavors.length > 0) {
        const answers = await inquirer.prompt([
          {
            type: 'list',
            name: 'flavor',
            message: 'Select Flavor:',
            choices: ['(Default)', ...cloudFlavors],
            default: '(Default)',
          },
        ])
        flavor = answers.flavor === '(Default)' ? undefined : answers.flavor
      }
    }

    // B. Environment Selection
    // Check if we already have config
    const loadedConfig = await configManager.loadConfig({environment, flavor})
    let env = environment || loadedConfig.defaultEnvironment

    if (!env) {
      const answers = await inquirer.prompt([
        {
          choices: ['dev', 'staging', 'prod'],
          default: 'staging',
          message: 'Select environment:',
          name: 'environment',
          type: 'list',
        },
      ])
      env = answers.environment
    }

    // C. Channel Selection
    if (!channel) {
      // Filter channels from cloud config
      const cloudChannels = cloudConfig?.channels?.map((c) => c.name) || [
        'development',
        'staging',
        'production',
        'beta',
        'stable',
      ]
      const channelMap: Record<string, string> = {dev: 'development', prod: 'stable', staging: 'beta'}
      const defaultChannel = channelMap[env!] || 'production'

      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'channel',
          message: 'Select Channel:',
          choices: Array.from(new Set([defaultChannel, ...cloudChannels])),
          default: defaultChannel,
        },
      ])
      channel = answers.channel
    }

    // D. Options (Active/Required)
    if (active === undefined && !flags.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'active',
          message: 'Activate immediately?',
          default: true,
        },
      ])
      active = answers.active
    } else if (active === undefined) {
      active = true
    }

    if (required === undefined && !flags.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'required',
          message: 'Mark as Required?',
          default: true,
        },
      ])
      required = answers.required
    } else if (required === undefined) {
      required = true
    }

    // E. Version Bump
    if (!version && !flags.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'version',
          message: 'Bump Version?',
          choices: ['None', 'patch', 'minor', 'major'],
          default: 'None',
        },
      ])
      version = answers.version === 'None' ? undefined : answers.version
    }

    // --- Config Loading & Confirmation ---

    // Final Config Load with resolved values
    const config = await configManager.loadConfig({...flags, environment: env, flavor})

    // Config confirm
    if (!flags.yes) {
      this.log(chalk.cyan('-------------------------------------'))
      this.log(`Environment: ${chalk.green(env)}`)
      if (flavor) this.log(`Flavor:      ${chalk.green(flavor)}`)
      this.log(`Channel:     ${chalk.green(channel)}`)
      this.log(`Active:      ${active ? chalk.green('Yes') : chalk.red('No')}`)
      this.log(`Required:    ${required ? chalk.green('Yes') : chalk.red('No')}`)
      this.log(`Version Bump:${chalk.green(version || 'none')}`)
      this.log(chalk.cyan('-------------------------------------'))

      const {confirm} = await inquirer.prompt([
        {
          default: true,
          message: 'Ready to deploy?',
          name: 'confirm',
          type: 'confirm',
        },
      ])
      if (!confirm) return
    }

    try {
      // Step 0: Version Bump
      if (version) {
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
      if (!env) {
        this.error('Environment is undefined')
        return
      }
      // We can run the sync command directly
      await VersionSync.run(['--environment', env, ...(version ? ['--bump'] : [])])

      // RELOAD config to get new version codes from .env files (via ConfigManager legacy loader)
      // Pass flavor so it loads correct .env
      const freshConfig = await configManager.loadConfig({...flags, environment: env, flavor})
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
        prod: 'io.aybinv7.vuena',
        staging: 'io.aybinv7.vuena.staging',
      }
      if (!env) {
        this.error('Environment is undefined')
        return
      }
      let appId = config.appId
        ? config.environments?.[env]?.appId || `${config.appId}${env === 'prod' ? '' : '.' + env}`
        : appIdMap[env]

      // If flavor is used, the App ID should ideally come from the loaded .env (VITE_APP_ID)
      // ConfigManager loads .env into freshConfig.
      // Let's check there first.
      if (freshConfig.VITE_APP_ID && typeof freshConfig.VITE_APP_ID === 'string') {
        appId = freshConfig.VITE_APP_ID
      }

      this.log('')
      this.log(chalk.cyan(`Deploying v${appVersion} (${versionCode}) to ${env}...`))
      this.log('')

      // Build Steps (1.5 - 4)
      if (!flags.skipBuild) {
        await runBuildSteps(
          {
            active: active!,
            env,
            flavor,
            platform: 'android', // Defaulting to android as per legacy script
            required: required!,
            skipAsset: flags.skipAsset,
            type: 'ota',
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
          fields: {
            active: active!.toString(),
            channel: channel!,
            environment: env,
            flavor: flavor ?? '',
            platform: 'android', // TODO: Make configurable
            releaseNotes: note ?? '',
            required: required!.toString(),
            version: appVersion,
          },
          fileField: 'bundle',
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.error(errorMessage)
    }
  }
}
