import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import path from 'node:path'

import {ConfigManager} from '../../utils/config.js'
import {runBuildSteps, runCommand, uploadFile} from '../../utils/deploy-helpers.js'
import VersionSync from '../version/sync.js'

export default class DeployNative extends Command {
  static description = 'Deploy a native update (APK/IPA)'
  static flags = {
    environment: Flags.string({char: 'e', options: ['dev', 'staging', 'prod']}),
    version: Flags.string({char: 'v', options: ['major', 'minor', 'patch']}),
    platform: Flags.string({char: 'p', options: ['android', 'ios'], default: 'android'}),
    channel: Flags.string({char: 'c'}),
    note: Flags.string({char: 'n'}),
    required: Flags.boolean({char: 'r', default: true, allowNo: true}),
    active: Flags.boolean({char: 'a', default: true, allowNo: true}),
    skipBuild: Flags.boolean({default: false}),
    skipAsset: Flags.boolean({char: 's', default: false}),
    yes: Flags.boolean({char: 'y', default: false}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DeployNative)
    const root = process.cwd()
    const configManager = new ConfigManager(root)
    const config = await configManager.loadConfig(flags)

    let env = config.environment
    if (!env) {
      env = (
        await inquirer.prompt([
          {
            type: 'list',
            name: 'environment',
            message: 'Select environment:',
            choices: ['dev', 'staging', 'prod'],
            default: 'staging',
          },
        ])
      ).environment
    }

    // Resolve channel
    const channelMap: Record<string, string> = {dev: 'development', staging: 'beta', prod: 'stable'}
    const channel = config.channel || channelMap[env] || 'production'

    if (!flags.yes) {
      const {confirm} = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Deploy NATIVE to ${env} (${flags.platform})?`,
          default: true,
        },
      ])
      if (!confirm) return
    }

    try {
      // Step 0: Version Bump & Sync
      if (flags.version) {
        console.log(chalk.magenta(`[0] Bumping version (${flags.version})...`))
        runCommand(`npm version ${flags.version} --no-git-tag-version`, root)
      }

      console.log(chalk.green('[1] Syncing version...'))
      await VersionSync.run(['--environment', env, ...(flags.version ? ['--bump'] : [])])

      // Reload config
      const freshConfig = await configManager.loadConfig({...flags, environment: env})
      const appVersion = (await fs.readJson(path.join(root, 'package.json'))).version
      const versionCode = freshConfig.VERSION_CODE
      const apiUrl = freshConfig.VITE_UPDATE_API_URL || freshConfig.endpoint

      if (!apiUrl) this.error('API URL not found!', {exit: 1})

      // Build Steps
      if (!flags.skipBuild) {
        await runBuildSteps(
          {
            env,
            platform: flags.platform,
            type: 'native',
            skipAsset: flags.skipAsset,
            required: flags.required,
            active: flags.active,
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
        const gradleCmd = isWindows ? '.\\gradlew.bat' : './gradlew'
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
          fileField: 'file',
          fields: {
            version: appVersion,
            version_code: versionCode,
            platform: flags.platform,
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
        this.log(chalk.green(`  Upload successful!`))
      } else {
        this.error(`Upload failed! HTTP ${result.status}`)
      }
    } catch (e: any) {
      this.error(e.message)
    }
  }
}
