import {Command} from '@oclif/core'
import chalk from 'chalk'

import {AuthService} from '../../services/auth.service.js'
import {ConfigManager} from '../../utils/config.js'

export default class AuthWhoami extends Command {
  static description = 'Show current logged in user and available apps'

  async run(): Promise<void> {
    const configManager = new ConfigManager(process.cwd())
    const config = await configManager.loadConfig()

    if (!config.user || !config.apiKey) {
      this.log('')
      this.log(chalk.yellow('  Not logged in.'))
      this.log(`  Run ${chalk.cyan('capucho-cli auth login')} to authenticate.`)
      this.log('')
      return
    }

    this.log('')
    this.log(chalk.cyan('╔═══════════════════════════════════════════╗'))
    this.log(chalk.cyan('║') + chalk.bold('            Current Session                 ') + chalk.cyan('║'))
    this.log(chalk.cyan('╚═══════════════════════════════════════════╝'))
    this.log('')
    this.log(`  ${chalk.bold('User:')}     ${chalk.green(config.user.email)}`)
    this.log(`  ${chalk.bold('Endpoint:')} ${config.endpoint}`)

    if (config.authenticatedAt) {
      const authDate = new Date(config.authenticatedAt)
      this.log(`  ${chalk.bold('Session:')}  ${chalk.gray(authDate.toLocaleString())}`)
    }

    // Organizations
    if (config.organizations && config.organizations.length > 0) {
      this.log('')
      this.log(chalk.bold('  Organizations:'))
      for (const org of config.organizations) {
        this.log(`    • ${org.name} ${chalk.gray(`(${org.role})`)}`)
      }
    }

    // Apps
    if (config.apps && config.apps.length > 0) {
      this.log('')
      this.log(chalk.bold('  Apps:'))
      for (const app of config.apps) {
        const isDefault = config.defaultAppId === app.app_id
        this.log(`    • ${app.name} ${chalk.gray(`(${app.app_id})`)}${isDefault ? chalk.green(' ✓ default') : ''}`)
      }
    } else {
      this.log('')
      this.log(chalk.gray('  No apps found.'))
    }

    if (config.defaultAppId) {
      this.log('')
      this.log(`  ${chalk.bold('Default App:')} ${chalk.cyan(config.defaultAppId)}`)
    }

    // Verify credentials are still valid
    const authService = new AuthService(process.cwd())
    const {valid} = await authService.verifyCredentials()

    if (!valid) {
      this.log('')
      this.log(chalk.yellow('  ⚠ Session may have expired. Run `capucho-cli auth login` to refresh.'))
    }

    this.log('')
  }
}
