import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import fs from 'fs-extra'
import {select, confirm, input} from '@inquirer/prompts'
import path from 'node:path'
import ora from 'ora'

import {AuthService} from '../../services/auth.service.js'
import {CloudService} from '../../services/cloud.service.js'
import {ConfigManager} from '../../utils/config.js'
import {deployToGhPages, findLatestZip, runBuildSteps, runCommand, uploadFile} from '../../utils/deploy-helpers.js'
import {MultiStepProgress} from '../../utils/progress.js'
import {syncVersion} from '../../utils/version.js'

export default class DeployOta extends Command {
  static description = 'Deploy an OTA update to your project'

  static examples = [
    '<%= config.bin %> <%= command.id %> -c staging -v patch',
    '<%= config.bin %> <%= command.id %> --note "Critical fix"',
  ]

  static flags = {
    active: Flags.boolean({
      allowNo: true,
      char: 'a',
      default: undefined,
      description: 'Activate update immediately',
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
    verbose: Flags.boolean({
      description: 'Show detailed output from build steps',
      default: false,
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
    const cloudService = new CloudService(root)
    const authService = new AuthService(root)

    // 0. Check Project Initialization
    const projectConfig = await cloudService.getProjectConfig()
    if (!projectConfig) {
      this.error(chalk.red('Project not initialized. Please run ') + chalk.cyan('capucho init') + chalk.red(' first.'))
    }

    // 1. Check Authentication
    const {valid, user} = await authService.verifyCredentials()
    if (!valid) {
      this.error(chalk.red('Not authenticated. Please run ') + chalk.cyan('capucho auth login') + chalk.red(' first.'))
    }

    this.log('')
    this.log(chalk.cyan('╔═══════════════════════════════════════════╗'))
    this.log(chalk.cyan('║') + chalk.bold('        Capucho OTA Deployment              ') + chalk.cyan('║'))
    this.log(chalk.cyan('╚═══════════════════════════════════════════╝'))
    this.log(chalk.gray(`  Project: ${projectConfig.appName}`))
    this.log(chalk.gray(`  User:    ${user?.email}`))
    this.log('')

    let {channel, active, required, note, version, verbose} = flags
    const {cloudAppId} = projectConfig
    let selectedChannelEnv: 'prod' | 'staging' | 'dev' = 'staging'

    // --- Interactive Wizard ---

    // B. Channel Selection
    const channels = await cloudService.getChannels(cloudAppId)
    if (!channel) {
      if (channels.length > 0) {
        channel = await select({
          message: 'Select Channel:',
          choices: channels.map((c) => ({name: `${c.name} (${c.environment})`, value: c.name})),
        })
      } else {
        channel = await input({
          message: 'Enter Channel Name:',
          default: 'production',
        })
      }
    }

    // Resolve channel environment
    const selectedChannel = channels.find((c) => c.name === channel)
    if (!selectedChannel) {
      this.error(chalk.red(`Channel '${channel}' not found in cloud. Please create it first in the dashboard.`))
    }
    if (!selectedChannel.environment) {
      this.error(chalk.red(`Channel '${channel}' has no environment configured. Please set it in the dashboard.`))
    }
    selectedChannelEnv = selectedChannel.environment
    const env = selectedChannelEnv

    // C. Options (Active/Required)
    if (active === undefined && !flags.yes) {
      active = await confirm({
        message: 'Activate immediately?',
        default: true,
      })
    } else if (active === undefined) {
      active = true
    }

    if (required === undefined && !flags.yes) {
      required = await confirm({
        message: 'Mark as Required?',
        default: true,
      })
    } else if (required === undefined) {
      required = true
    }

    // D. Version Bump
    if (!version && !flags.yes) {
      version = await select({
        message: 'Bump Version?',
        choices: [
          {name: 'None', value: ''},
          {name: 'patch', value: 'patch'},
          {name: 'minor', value: 'minor'},
          {name: 'major', value: 'major'},
        ],
        default: '',
      })
    }

    // E. Release Notes
    if (!note && !flags.yes) {
      note = await input({
        message: 'Release Notes (optional):',
      })
    }

    // --- Confirmation ---
    if (!flags.yes) {
      this.log('')
      this.log(chalk.cyan('─────────────────────────────────────────'))
      this.log(`  App:         ${chalk.green(projectConfig.appName)}`)
      this.log(`  Cloud ID:    ${chalk.gray(cloudAppId)}`)
      this.log(`  Channel:     ${chalk.green(channel)}`)
      this.log(`  Active:      ${active ? chalk.green('Yes') : chalk.red('No')}`)
      this.log(`  Required:    ${required ? chalk.green('Yes') : chalk.red('No')}`)
      this.log(`  Version:     ${chalk.green(version || 'no bump')}`)
      this.log(chalk.cyan('─────────────────────────────────────────'))
      this.log('')

      const shouldDeploy = await confirm({
        message: 'Ready to deploy?',
        default: true,
      })
      if (!shouldDeploy) return
    }

    const progress = new MultiStepProgress()

    try {
      const totalSteps = 9
      progress.start(totalSteps, 'Initializing deployment...')

      // Step 1: Version Bump
      if (version) {
        progress.updateMessage(`[1/${totalSteps}] Bumping version (${version})...`)
        await runCommand(`npm version ${version} --no-git-tag-version`, root, true)
      } else {
        progress.updateMessage(`[1/${totalSteps}] Skipping version bump...`)
      }

      // Step 2: Sync Version
      progress.nextStep(`[2/${totalSteps}] Syncing version to project files...`)
      const {version: appVersion} = await syncVersion(root, env, !!version)

      const freshConfig = await configManager.loadConfig()
      const apiUrl = freshConfig.endpoint as string

      // Step 3-6: Build Steps
      if (!flags.skipBuild) {
        await runBuildSteps(
          {
            active: active!,
            env,
            platform: 'android',
            required: required!,
            skipAsset: flags.skipAsset,
            type: 'ota',
          },
          root,
          progress,
          3,
          totalSteps,
        )
      } else {
        progress.updateMessage(`[3/${totalSteps}] Skipping build steps...`)
      }

      // Step 7: Bundle (OTA specific)
      progress.nextStep(`[7/${totalSteps}] Creating OTA bundle...`)
      await runCommand(`npx @capgo/cli bundle zip ${projectConfig.appId} --bundle ${appVersion} --json`, root, true)

      const zipFile = findLatestZip(root)
      if (!zipFile) {
        throw new Error('Bundle zip not created!')
      }

      // Step 8: Deploy Assets to GH Pages
      progress.nextStep(`[8/${totalSteps}] Deploying assets to GitHub Pages...`)
      if (!flags.skipAsset) {
        try {
          const repoUrl = projectConfig.ghPagesRepo || 'https://github.com/inventor7/Vuena.git'
          await deployToGhPages(path.join(root, 'dist'), repoUrl)
        } catch (err) {
          this.warn('Failed to deploy assets to GitHub Pages. Continuing with OTA...')
        }
      } else {
        progress.updateMessage(`[8/${totalSteps}] Skipping asset deployment...`)
      }

      // Step 9: Upload to Capucho Cloud
      progress.nextStep(`[9/${totalSteps}] Uploading OTA bundle to cloud...`)
      const uploadUrl = `${apiUrl}/api/admin/upload`

      const result = await uploadFile(
        uploadUrl,
        zipFile.path,
        {
          fields: {
            active: active!.toString(),
            app_id: projectConfig.appId,
            channel: channel!,
            platform: 'android',
            release_notes: note ?? '',
            required: required!.toString(),
            version_name: appVersion,
          },
          fileField: 'bundle',
        },
        freshConfig.apiKey as string,
      )

      if (result.success || (result.data && result.data.success)) {
        progress.finish(`Successfully deployed v${appVersion} to '${channel}'!`)
        fs.unlinkSync(zipFile.path)
      } else {
        progress.fail('Upload failed')
        this.log(chalk.red(`\n  Server responded with: ${JSON.stringify(result.data)}\n`))
        return
      }

      // Success!
      this.log('')
      this.log(chalk.green('╔═══════════════════════════════════════════╗'))
      this.log(chalk.green('║') + chalk.bold('        Deployment Complete! 🚀            ') + chalk.green('║'))
      this.log(chalk.green('╚═══════════════════════════════════════════╝'))
      this.log(chalk.cyan(`  ${projectConfig.appName} v${appVersion} → '${channel}'`))
      this.log('')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      progress.fail(`Deployment failed: ${errorMessage}`)
      this.error(chalk.red('\n  See capucho-deploy.log for more details.\n'))
    }
  }
}
