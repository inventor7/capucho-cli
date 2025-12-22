import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import {input, password} from '@inquirer/prompts'
import ora from 'ora'

import {AuthService} from '../../services/auth.service.js'
import {ConfigManager} from '../../utils/config.js'

export default class AuthLogin extends Command {
  static description = 'Authenticate with Capucho platform using an API key'

  static examples = [
    '<%= config.bin %> auth login',
    '<%= config.bin %> auth login --api-key cap_xxxx',
    '<%= config.bin %> auth login --endpoint https://your-server.com',
  ]

  static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'API key (get from Settings > API Keys in dashboard)',
      required: false,
    }),
    endpoint: Flags.string({
      char: 'e',
      description: 'API endpoint',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthLogin)
    const root = process.cwd()

    // Header
    this.log('')
    this.log(chalk.cyan('╔═══════════════════════════════════════════╗'))
    this.log(chalk.cyan('║') + chalk.bold('          Capucho CLI Login                 ') + chalk.cyan('║'))
    this.log(chalk.cyan('╚═══════════════════════════════════════════╝'))
    this.log('')

    await AuthLogin.performLogin(root, flags.endpoint, flags['api-key'])
  }

  /**
   * Static method to perform login, can be called from other commands
   */
  public static async performLogin(root: string, flagEndpoint?: string, flagApiKey?: string): Promise<void> {
    const configManager = new ConfigManager(root)
    const authService = new AuthService(root)
    const currentConfig = await configManager.loadConfig()

    // 1. Get API Endpoint
    let endpoint = flagEndpoint

    if (!endpoint) {
      endpoint = await input({
        message: 'Capucho API Endpoint:',
        default: currentConfig.endpoint || 'https://capucho-back.onrender.com',
        validate: (value) => {
          if (!value.startsWith('http://') && !value.startsWith('https://')) {
            return 'Endpoint must start with http:// or https://'
          }
          return true
        },
      })
    } else {
      console.log(chalk.gray(`  Using endpoint: ${endpoint}`))
    }

    // 2. Get API Key
    let apiKey = flagApiKey

    if (!apiKey) {
      console.log('')
      console.log(chalk.yellow('  Get your API key from Settings > API Keys in the dashboard'))
      console.log(chalk.gray(`  Dashboard: ${endpoint.replace('/api', '')}`))
      console.log('')

      apiKey = await password({
        message: 'Enter your API Key:',
        validate: (value) => {
          if (!value.startsWith('cap_')) {
            return 'API key should start with "cap_"'
          }
          if (value.length < 10) {
            return 'API key is too short'
          }
          return true
        },
      })
    }

    const spinner = ora('Validating credentials...').start()

    try {
      // Validate by fetching user profile
      const profile = await authService.fetchUserProfile(endpoint as string, apiKey as string)

      if (!profile) {
        spinner.fail('Authentication failed')
        console.log(chalk.red('\n  Invalid API key or unreachable endpoint.'))
        console.log(chalk.gray('  Please check your credentials and try again.\n'))
        throw new Error('Authentication failed')
      }

      spinner.succeed('Authenticated successfully!')

      // Save to global config
      await configManager.setGlobalConfig('apiKey', apiKey)
      await configManager.setGlobalConfig('endpoint', endpoint)
      await configManager.setGlobalConfig('user', profile.user)
      await configManager.setGlobalConfig('authenticatedAt', new Date().toISOString())

      // Welcome message
      console.log('')
      console.log(chalk.green('─────────────────────────────────────────'))
      console.log(chalk.bold(`  Welcome, ${profile.user.email}!`))
      console.log(chalk.green('─────────────────────────────────────────'))
      console.log('')
    } catch (error: unknown) {
      spinner.fail('Login failed')
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.log(chalk.red(`\n  Error: ${errorMessage}\n`))
      throw error
    }
  }
}
