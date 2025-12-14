import {Command} from '@oclif/core'
import inquirer from 'inquirer'
import chalk from 'chalk'
import {ConfigManager} from '../../utils/config.js'

export default class ConfigInit extends Command {
  static description = 'Initialize Capucho CLI configuration in your project'

  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    this.log(chalk.cyan('Setting up Capucho CLI in your project...\n'))

    const configManager = new ConfigManager(process.cwd())
    const configPath = configManager.getProjectConfigPath()

    // Interactive setup
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'appId',
        message: 'App ID (e.g., io.company.app):',
        validate: (input: string) => /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(input) || 'Invalid app ID format',
      },
      {
        type: 'input',
        name: 'appName',
        message: 'App Name:',
        validate: (input: string) => input.length > 0 || 'App name required',
      },
      {
        type: 'checkbox',
        name: 'platforms',
        message: 'Select platforms:',
        choices: ['android', 'ios'],
        default: ['android'],
      },
      {
        type: 'list',
        name: 'defaultEnv',
        message: 'Default environment:',
        choices: ['dev', 'staging', 'prod'],
        default: 'staging',
      },
    ])

    // Create config object
    const config = {
      appId: answers.appId,
      appName: answers.appName,
      platforms: answers.platforms,
      defaultEnvironment: answers.defaultEnv,
      environments: {
        dev: {
          channel: 'development',
          appId: `${answers.appId}.dev`,
        },
        staging: {
          channel: 'beta',
          appId: `${answers.appId}.staging`,
        },
        prod: {
          channel: 'stable',
          appId: answers.appId,
        },
      },
    }

    // Save using ConfigManager logic (manually for now to ensure we write the whole object)
    // We could use configManager.setProjectConfig for individual keys, but we want to write the initial structure.
    await configManager.setProjectConfig('appId', config.appId)
    await configManager.setProjectConfig('appName', config.appName)
    await configManager.setProjectConfig('platforms', config.platforms)
    await configManager.setProjectConfig('defaultEnvironment', config.defaultEnvironment)
    await configManager.setProjectConfig('environments', config.environments)

    this.log('')
    this.log(chalk.green('✓ Configuration created successfully at ' + configPath))
    this.log('')
    this.log(chalk.gray('Next steps:'))
    this.log(chalk.gray('  1. Run: capucho-cli auth:login'))
    this.log(chalk.gray('  2. Run: capucho-cli deploy:ota'))
    this.log('')
  }
}
