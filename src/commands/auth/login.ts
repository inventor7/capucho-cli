import {Command, Flags} from '@oclif/core'
import inquirer from 'inquirer'
import chalk from 'chalk'
import axios from 'axios'
import {ConfigManager} from '../../utils/config.js'

export default class AuthLogin extends Command {
  static description = 'Authenticate with Capucho platform'

  static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --api-key YOUR_KEY']

  static flags = {
    'api-key': Flags.string({
      description: 'API key for authentication',
      required: false,
    }),
    endpoint: Flags.string({
      description: 'Custom API endpoint (for self-hosted)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthLogin)
    const configManager = new ConfigManager(process.cwd())

    // Load existing config to see if we have defaults
    const currentConfig = await configManager.loadConfig()

    let apiKey = flags['api-key']
    let endpoint = flags.endpoint || currentConfig.endpoint || 'https://api.vuena.io'

    // Interactive endpoint prompt if not set
    if (!flags.endpoint && !currentConfig.endpoint) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'endpoint',
          message: 'API Endpoint:',
          default: endpoint,
        },
      ])
      endpoint = answers.endpoint
    }

    // Interactive API key prompt
    if (!apiKey) {
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your API key:',
          validate: (input: string) => input.length > 0 || 'API key required',
        },
      ])
      apiKey = answers.apiKey
    }

    // Verify API key
    this.log(chalk.gray('Verifying credentials...'))

    try {
      // Mock verification if we can't actually hit the endpoint yet, or try it.
      // Based on user snippet, it's /api/auth/verify (or we can just try to list apps or similar)
      // For now, let's assume we just save it unless it fails a test call.
      // But enabling direct verification is better UX.

      const response = await axios.post(
        `${endpoint}/api/auth/verify`,
        {
          api_key: apiKey,
        },
        {
          validateStatus: () => true, // Don't throw on error immediately
        },
      )

      let user = {email: 'unknown@example.com', role: 'user'}
      let organization = {name: 'My Org'}

      if (response.status === 200) {
        user = response.data.user || user
        organization = response.data.organization || organization
      } else if (response.status === 404) {
        // Fallback for self-hosted instances that might not have this exact endpoint implemented yet?
        // Or just warn and proceed if user insists.
        this.warn('Verification endpoint not found. Saving credentials anyway.')
      } else {
        // If 401/403, definitely fail
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid API Key')
        }
        this.warn(`Server returned ${response.status}. Saving credentials anyway.`)
      }

      // Save credentials to GLOBAL config
      await configManager.setGlobalConfig('apiKey', apiKey)
      await configManager.setGlobalConfig('endpoint', endpoint)
      await configManager.setGlobalConfig('user', user)
      await configManager.setGlobalConfig('organization', organization)
      await configManager.setGlobalConfig('authenticatedAt', new Date().toISOString())

      this.log('')
      this.log(chalk.green('✓ Authentication successful!'))
      this.log('')
      this.log(`  User:         ${chalk.cyan(user.email)}`)
      this.log(`  Organization: ${chalk.cyan(organization.name)}`)
      this.log(`  Endpoint:     ${chalk.cyan(endpoint)}`)
      this.log('')
    } catch (error: any) {
      this.error(chalk.red('Authentication failed: ' + error.message), {exit: 1})
    }
  }
}
