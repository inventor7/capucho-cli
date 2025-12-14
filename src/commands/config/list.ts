import {Command} from '@oclif/core'
import chalk from 'chalk'
import {ConfigManager} from '../../utils/config.js'

export default class ConfigList extends Command {
  static description = 'List current configuration'

  async run(): Promise<void> {
    const configManager = new ConfigManager(process.cwd())
    const config = await configManager.loadConfig() // Resolved config

    this.log(chalk.cyan('Resolved Configuration:'))
    this.log(JSON.stringify(config, null, 2))

    this.log('')
    this.log(chalk.gray(`Project Config: ${configManager.getProjectConfigPath()}`))
    this.log(chalk.gray(`Global Config:  ${configManager.getGlobalConfigPath()}`))
  }
}
