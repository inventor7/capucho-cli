import {Command} from '@oclif/core'
import chalk from 'chalk'
import {ConfigManager} from '../../utils/config.js'

export default class AuthLogout extends Command {
  static description = 'Log out and clear credentials'

  async run(): Promise<void> {
    const configManager = new ConfigManager(process.cwd())

    await configManager.setGlobalConfig('apiKey', undefined)
    await configManager.setGlobalConfig('user', undefined)
    await configManager.setGlobalConfig('organization', undefined)
    await configManager.setGlobalConfig('authenticatedAt', undefined)
    // removing endpoint? maybe keep it as preference. Let's keep endpoint.

    this.log(chalk.green('✓ Logged out successfully. Credentials cleared.'))
  }
}
