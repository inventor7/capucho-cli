import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import fs from 'fs-extra'
import {select, confirm, input} from '@inquirer/prompts'
import path from 'node:path'
import ora from 'ora'

import {AuthService} from '../../services/auth.service.js'
import {CloudService} from '../../services/cloud.service.js'
import {ConfigManager} from '../../utils/config.js'
import {deployToGhPages, findApk, runBuildSteps, runCommand, uploadFile} from '../../utils/deploy-helpers.js'
import {MultiStepProgress} from '../../utils/progress.js'
import {syncVersion} from '../../utils/version.js'

export default class DeployNative extends Command {
  static description = 'Deploy a native update (APK/IPA) to your project'

  static flags = {
    active: Flags.boolean({allowNo: true, char: 'a', default: undefined, description: 'Activate update immediately'}),
    channel: Flags.string({char: 'c', description: 'Release channel'}),
    note: Flags.string({char: 'n', default: '', description: 'Release notes'}),
    platform: Flags.string({
      char: 'p',
      default: 'android',
      options: ['android', 'ios'],
      description: 'Target platform',
    }),
    type: Flags.string({
      char: 't',
      options: ['debug', 'release'],
      description: 'Build type (debug for unsigned, release for signed)',
    }),
    required: Flags.boolean({allowNo: true, char: 'r', default: undefined, description: 'Mark as required update'}),
    skipAsset: Flags.boolean({char: 's', default: false, description: 'Skip asset generation'}),
    skipBuild: Flags.boolean({default: false, description: 'Skip build step'}),
    version: Flags.string({
      char: 'v',
      default: undefined,
      options: ['major', 'minor', 'patch'],
      description: 'Version bump type',
    }),
    verbose: Flags.boolean({description: 'Show detailed output from build steps', default: false}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Skip confirmation prompts'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DeployNative)
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
    this.log(chalk.cyan('║') + chalk.bold('       Capucho Native Deployment            ') + chalk.cyan('║'))
    this.log(chalk.cyan('╚═══════════════════════════════════════════╝'))
    this.log(chalk.gray(`  Project: ${projectConfig.appName}`))
    this.log(chalk.gray(`  User:    ${user?.email}`))
    this.log('')

    let {channel, active, required, note, version, type} = flags
    const {cloudAppId} = projectConfig
    const env = 'prod'

    // --- Interactive Wizard ---

    // B. Channel Selection
    if (!channel) {
      const channels = await cloudService.getChannels(cloudAppId)
      if (channels.length > 0) {
        channel = await select({
          message: 'Select Channel:',
          choices: channels.map((c) => ({name: c.name, value: c.name})),
        })
      } else {
        channel = await input({
          message: 'Enter Channel Name:',
          default: 'production',
        })
      }
    }

    // C. Options (Active/Required)
    if (active === undefined && !flags.yes) {
      active = await confirm({
        message: 'Activate immediately?',
        default: true,
      })
    } else if (active === undefined) active = true

    if (required === undefined && !flags.yes) {
      required = await confirm({
        message: 'Mark as required?',
        default: true,
      })
    } else if (required === undefined) required = true

    // D. Build Type
    if (!type && !flags.yes) {
      type = await select({
        message: 'Select Build Type:',
        choices: [
          {name: 'Release (Signed)', value: 'release'},
          {name: 'Debug (Unsigned)', value: 'debug'},
        ],
        default: 'release',
      })
    } else if (!type) {
      type = 'release'
    }

    // E. Version Bump
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

    // F. Release Notes
    if (!note && !flags.yes) {
      note = await input({
        message: 'Release Notes (optional):',
      })
    }

    // Confirmation
    if (!flags.yes) {
      this.log('')
      this.log(chalk.cyan('─────────────────────────────────────────'))
      this.log(`  App:         ${chalk.green(projectConfig.appName)}`)
      this.log(`  Platform:    ${chalk.green(flags.platform)}`)
      this.log(`  Build Type:  ${chalk.green(type)}`)
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
      const {version: appVersion, versionCode} = await syncVersion(root, env, !!version)

      const freshConfig = await configManager.loadConfig()
      const apiUrl = freshConfig.endpoint as string

      // Step 3-6: Build Steps
      await runBuildSteps(
        {
          active: active!,
          env,
          platform: flags.platform,
          required: required!,
          skipAsset: flags.skipAsset,
          type: 'native',
        },
        root,
        progress,
        3,
        totalSteps,
      )

      // Step 7: Native Compilation
      progress.nextStep(`[7/${totalSteps}] Compiling native ${flags.platform} (${type})...`)

      let filePath: string | null = null
      if (flags.platform === 'android') {
        const androidDir = path.join(root, 'android')
        const isWindows = process.platform === 'win32'
        const gradleCmd = isWindows ? String.raw`.\gradlew.bat` : './gradlew'
        const assembleTask = type === 'release' ? 'assembleRelease' : 'assembleDebug'

        await runCommand(`${gradleCmd} ${assembleTask}`, androidDir, true)
        filePath = findApk(androidDir, type as 'debug' | 'release')
      } else {
        throw new Error('iOS native build not yet implemented via CLI')
      }

      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`Native build artifact not found! Checked variants for '${type}'.`)
      }

      // Step 8: Deploy Assets to GH Pages
      progress.nextStep(`[8/${totalSteps}] Deploying assets to GitHub Pages...`)
      if (!flags.skipAsset) {
        try {
          const repoUrl = projectConfig.ghPagesRepo || 'https://github.com/inventor7/Vuena.git'
          await deployToGhPages(path.join(root, 'dist'), repoUrl)
        } catch (err) {
          this.warn('Failed to deploy assets to GitHub Pages. Continuing with native upload...')
        }
      } else {
        progress.updateMessage(`[8/${totalSteps}] Skipping asset deployment...`)
      }

      // Step 9: Upload to Capucho Cloud
      progress.nextStep(`[9/${totalSteps}] Uploading native artifact to cloud...`)
      const uploadUrl = `${apiUrl}/api/admin/native-upload`

      const result = await uploadFile(
        uploadUrl,
        filePath,
        {
          fields: {
            active: active!.toString(),
            app_id: projectConfig.appId,
            channel: channel!,
            platform: flags.platform,
            release_notes: note ?? '',
            required: required!.toString(),
            version_name: appVersion,
            version_code: versionCode,
          },
          fileField: 'bundle',
        },
        freshConfig.apiKey as string,
      )

      if (result.success || (result.data && result.data.success)) {
        progress.finish(`Successfully deployed v${appVersion} (${versionCode}) to '${channel}'!`)
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
      this.log(chalk.cyan(`  ${projectConfig.appName} v${appVersion} (${versionCode}) → '${channel}'`))
      this.log('')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      progress.fail(`Deployment failed: ${errorMessage}`)
      this.error(chalk.red('\n  See capucho-deploy.log for more details.\n'))
    }
  }
}
