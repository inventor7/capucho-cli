import {Command} from '@oclif/core'
import chalk from 'chalk'
import inquirer from 'inquirer'

import {ConfigManager} from '../../utils/config.js'
import DeployNative from '../deploy/native.js'
import DeployOta from '../deploy/ota.js'

export default class ConfigInit extends Command {
  static description = 'Initialize Capucho CLI configuration in your project'
  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    this.log(chalk.cyan('Setting up Capucho CLI in your project...\n'))

    const configManager = new ConfigManager(process.cwd())

    // Interactive setup
    const answers = await inquirer.prompt([
      {
        message: 'App ID (e.g., io.company.app):',
        name: 'appId',
        type: 'input',
        validate: (input: string) => /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(input) || 'Invalid app ID format',
      },
      {
        message: 'App Name:',
        name: 'appName',
        type: 'input',
        validate: (input: string) => input.length > 0 || 'App name required',
      },
      {
        choices: ['android', 'ios'],
        default: ['android'],
        message: 'Select platforms:',
        name: 'platforms',
        type: 'checkbox',
      },
      {
        choices: ['dev', 'staging', 'prod'],
        default: 'staging',
        message: 'Default environment:',
        name: 'defaultEnv',
        type: 'list',
      },
    ])

    // Create config object
    const config = {
      appId: answers.appId,
      appName: answers.appName,
      defaultEnvironment: answers.defaultEnv,
      environments: {
        dev: {
          appId: `${answers.appId}.dev`,
          channel: 'dev',
        },
        prod: {
          appId: answers.appId,
          channel: 'prod',
        },
        staging: {
          appId: `${answers.appId}.staging`,
          channel: 'staging',
        },
      },
      platforms: answers.platforms,
    }

    // Save using ConfigManager logic
    for (const [key, value] of Object.entries(config)) {
      await configManager.setProjectConfig(key, value)
    }

    const configPath = configManager.getProjectConfigPath()
    this.log(chalk.green('\n✓ Configuration saved to ' + configPath))

    // Onboarding Walkthrough
    this.log(chalk.cyan('\n🚀 Ready to launch!'))

    const {action} = await inquirer.prompt([
      {
        name: 'action',

        type: 'list',
        message: 'What would you like to do next?',
        choices: [
          {name: 'Deploy OTA Update', value: 'ota'},
          {name: 'Deploy Native Build', value: 'native'},
          {name: 'Nothing for now', value: 'exit'},
        ],
      },
    ])

    if (action === 'ota') {
      const otaArgs = ['--environment', answers.defaultEnv]
      await DeployOta.run(otaArgs)
    } else if (action === 'native') {
      const platform = answers.platforms[0] || 'android'
      const nativeArgs = ['--environment', answers.defaultEnv, '--platform', platform]
      await DeployNative.run(nativeArgs)
    }
  }
}
