import {Command, Flags} from '@oclif/core'
import axios from 'axios'
import chalk from 'chalk'
import inquirer from 'inquirer'
import ora from 'ora'

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

    let endpoint = flags.endpoint || currentConfig.endpoint || 'https://api.vuena.io'

    // Interactive endpoint prompt if not set
    if (!flags.endpoint && !currentConfig.endpoint) {
      const answers = await inquirer.prompt([
        {
          default: endpoint,
          message: 'API Endpoint:',
          name: 'endpoint',
          type: 'input',
        },
      ])
      endpoint = answers.endpoint
    }

    // Auth Method Selection
    const {method} = await inquirer.prompt([
      {
        type: 'list',
        name: 'method',
        message: 'How would you like to login?',
        choices: [
          {name: 'API Key', value: 'apikey'},
          {name: 'Email & Password', value: 'email'},
        ],
      },
    ])

    let apiKey = ''
    let userStr = 'Unknown'
    let spinner = ora('Processing...').start()
    spinner.stop()

    try {
      if (method === 'email') {
        const credentials = await inquirer.prompt([
          {name: 'email', message: 'Email:', type: 'input'},
          {name: 'password', message: 'Password:', type: 'password'},
        ])
        spinner.start('Authenticating...')

        // Attempt login via API
        try {
          const response = await axios.post(`${endpoint}/api/auth/login`, {
            email: credentials.email,
            password: credentials.password,
          })

          if (response.data && response.data.token) {
            apiKey = response.data.token
            userStr = credentials.email
            spinner.succeed('Login successful')
          } else {
            throw new Error('No token returned')
          }
        } catch {
          spinner.fail('Login failed.')
          this.log(chalk.yellow('Tip: Ensure your backend has /api/auth/login implemented.'))
          this.log(chalk.yellow('Falling back to API Key input...'))

          // Fallback
          const answer = await inquirer.prompt([
            {
              message: 'Enter your API Key manually:',
              name: 'apiKey',
              type: 'password',
              validate: (input: string) => input.length > 0 || 'API Key is required',
            },
          ])
          apiKey = answer.apiKey
        }
      } else {
        // API Key flow
        if (currentConfig.apiKey) {
          const {useExisting} = await inquirer.prompt([
            {
              default: true,
              message: `Found existing API key. Use it?`,
              name: 'useExisting',
              type: 'confirm',
            },
          ])
          if (useExisting) apiKey = currentConfig.apiKey as string
        }

        if (!apiKey) {
          const answer = await inquirer.prompt([
            {
              message: 'Enter your API Key:',
              name: 'apiKey',
              type: 'password',
              validate: (input: string) => input.length > 0 || 'API Key is required',
            },
          ])
          apiKey = answer.apiKey
        }
      }

      spinner.start('Verifying API Key...')

      // Verification call
      let organization = {name: 'My Org'}
      try {
        const response = await axios.get(`${endpoint}/api/auth/me`, {
          headers: {Authorization: `Bearer ${apiKey}`},
          validateStatus: () => true,
        })

        if (response.status === 200) {
          userStr = response.data.email || response.data.user || userStr
          organization = response.data.organization || organization
          spinner.succeed(chalk.green(`Authenticated as ${userStr}`))
        } else {
          spinner.warn(`Verification returned ${response.status}. Saving credentials anyway.`)
        }
      } catch {
        spinner.warn('Could not verify identity (/api/auth/me failed), but saving credentials anyway.')
      }

      // Save credentials to GLOBAL config
      await configManager.setGlobalConfig('apiKey', apiKey)
      await configManager.setGlobalConfig('endpoint', endpoint)
      await configManager.setGlobalConfig('user', {email: userStr})
      await configManager.setGlobalConfig('organization', organization)
      await configManager.setGlobalConfig('authenticatedAt', new Date().toISOString())

      this.log(chalk.green('\n✓ Login successful!'))
    } catch (error: unknown) {
      if (spinner.isSpinning) spinner.fail('Authentication process failed.')
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.error(chalk.red('Error: ' + errorMessage), {exit: 1})
    }
  }
}
