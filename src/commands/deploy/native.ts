import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import path from 'node:path'

import {CloudConfigService} from '../../services/cloud-config.js'
import {ConfigManager} from '../../utils/config.js'
import {runBuildSteps, runCommand, uploadFile} from '../../utils/deploy-helpers.js'
import VersionSync from '../version/sync.js'

export default class DeployNative extends Command {
  static description = 'Deploy a native update (APK/IPA)'
  static flags = {
    active: Flags.boolean({allowNo: true, char: 'a', default: undefined}),
    channel: Flags.string({char: 'c'}),
    environment: Flags.string({char: 'e', default: undefined, options: ['dev', 'staging', 'prod']}),
    flavor: Flags.string({char: 'f', description: 'Client/Flavor name (e.g. clientA)'}),
    note: Flags.string({char: 'n', default: ''}),
    platform: Flags.string({char: 'p', default: 'android', options: ['android', 'ios']}),
    required: Flags.boolean({allowNo: true, char: 'r', default: undefined}),
    skipAsset: Flags.boolean({char: 's', default: false}),
    skipBuild: Flags.boolean({default: false}),
    version: Flags.string({char: 'v', default: undefined, options: ['major', 'minor', 'patch']}),
    yes: Flags.boolean({char: 'y', default: false}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DeployNative)
    const root = process.cwd()
    const configManager = new ConfigManager(root)
    const cloudService = new CloudConfigService(root)

    // 1. Fetch Cloud Config
    const cloudConfig = await cloudService.fetchProjectConfig()

    let {environment, flavor, channel, active, required, note, version} = flags

    // --- Interactive Wizard ---

    // Flavor
    if (!flavor) {
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

    // Environment
    if (!environment) {
      const config = await configManager.loadConfig({environment, flavor})
      if (config.defaultEnvironment) {
        environment = config.defaultEnvironment
      } else {
        const answers = await inquirer.prompt([
          {
            choices: ['dev', 'staging', 'prod'],
            default: 'staging',
            message: 'Select environment:',
            name: 'environment',
            type: 'list',
          },
        ])
        environment = answers.environment
      }
    }
    const env = environment! // Assert

    // Channel
    if (!channel) {
      const cloudChannels = cloudConfig?.channels?.map((c) => c.name) || [
        'development',
        'staging',
        'production',
        'beta',
        'stable',
      ]
      const channelMap: Record<string, string> = {dev: 'development', prod: 'stable', staging: 'beta'}
      const defaultChannel = channelMap[env] || 'production'

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

    // Options
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
    } else if (active === undefined) active = true

    if (required === undefined && !flags.yes) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'required',
          message: 'Mark as required?',
          default: true,
        },
      ])
      required = answers.required
    } else if (required === undefined) required = true

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
          message: `Deploy NATIVE to ${env} (${flags.platform})${flavor ? ` for ${flavor}` : ''}?`,
          name: 'confirm',
          type: 'confirm',
        },
      ])
      if (!confirm) return
    }

    try {
      // Step 0: Version Bump & Sync
      if (version) {
        console.log(chalk.magenta(`[0] Bumping version (${flags.version})...`))
        runCommand(`npm version ${flags.version} --no-git-tag-version`, root)
      }

      console.log(chalk.green('[1] Syncing version...'))
      if (!env) {
        this.error('Environment is undefined')
        return
      }
      await VersionSync.run(['--environment', env, ...(version ? ['--bump'] : [])])

      // Reload config
      const freshConfig = await configManager.loadConfig({...flags, environment: env, flavor})
      const appVersion = (await fs.readJson(path.join(root, 'package.json'))).version
      const versionCode = freshConfig.VERSION_CODE
      const apiUrl = freshConfig.VITE_UPDATE_API_URL || freshConfig.endpoint

      if (!apiUrl) this.error('API URL not found!', {exit: 1})

      // Build Steps
      if (!flags.skipBuild) {
        await runBuildSteps(
          {
            active: active!,
            env,
            flavor: flavor,
            platform: flags.platform,
            required: required!,
            skipAsset: flags.skipAsset,
            type: 'native',
          },
          root,
        )
      }

      // Native Build
      console.log(chalk.green(`[5] Compiling native ${flags.platform}...`))

      let filePath = ''
      if (flags.platform === 'android') {
        const androidDir = path.join(root, 'android')
        const isWindows = process.platform === 'win32'
        const gradleCmd = isWindows ? String.raw`.\gradlew.bat` : './gradlew'
        const assembleTask = env === 'prod' ? 'assembleRelease' : 'assembleDebug'

        runCommand(`${gradleCmd} ${assembleTask}`, androidDir)

        const apkName = env === 'prod' ? 'app-release.apk' : 'app-debug.apk'
        const apkPath = env === 'prod' ? 'app/build/outputs/apk/release' : 'app/build/outputs/apk/debug'
        filePath = path.join(androidDir, apkPath, apkName)
      } else {
        this.error('iOS native build not yet implemented via CLI', {exit: 1})
      }

      if (!fs.existsSync(filePath)) {
        this.error(`Native build artifact not found at ${filePath}`)
      }

      // Upload
      console.log(chalk.green('[6] Uploading native artifact...'))
      const uploadUrl = `${apiUrl}/api/admin/native-upload`

      const result = await uploadFile(
        uploadUrl,
        filePath,
        {
          fields: {
            active: active!.toString(),
            channel: channel!,
            environment: env,
            flavor: flavor ?? '',
            platform: flags.platform,
            releaseNotes: note ?? '',
            required: required!.toString(),
            version: appVersion,
            versionCode: versionCode ?? '',
          },
          fileField: 'file',
        },
        freshConfig.apiKey,
      )

      if (result.success || (result.data && result.data.success)) {
        this.log(chalk.green(`  Upload successful!`))
      } else {
        this.error(`Upload failed! HTTP ${result.status}`)
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.error(errorMessage)
    }
  }
}
