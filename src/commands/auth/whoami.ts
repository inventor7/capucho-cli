import {Command} from '@oclif/core'
import chalk from 'chalk'

import {ConfigManager} from '../../utils/config.js'

export default class AuthWhoami extends Command {
  static description = 'Show current logged in user'

  async run(): Promise<void> {
    const configManager = new ConfigManager(process.cwd())
    const config = await configManager.loadConfig()

    if (!config.user || !config.apiKey) {
      this.log('Not logged in.')
      this.log(`Run ${chalk.cyan('capucho-cli auth:login')} to authenticate.`)
      return
    }

    this.log('')
    this.log(`  User:         ${chalk.cyan(config.user.email)}`)
    this.log(`  Organization: ${chalk.cyan(config.organization?.name || 'N/A')}`)
    this.log(`  Endpoint:     ${chalk.cyan(config.endpoint)}`)
    this.log('')
  }
}
