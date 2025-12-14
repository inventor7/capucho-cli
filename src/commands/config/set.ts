import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import {ConfigManager} from '../../utils/config.js'

export default class ConfigSet extends Command {
  static description = 'Set a configuration value'

  static args = {
    key: {name: 'key', required: true, description: 'Config key (e.g. apiKey, defaultEnvironment)'},
    value: {name: 'value', required: true, description: 'Config value'},
  }

  static flags = {
    global: Flags.boolean({char: 'g', description: 'Set in global config', default: false}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ConfigSet)
    const configManager = new ConfigManager(process.cwd())

    if (flags.global) {
      await configManager.setGlobalConfig(args.key, args.value)
      this.log(chalk.green(`✓ Global config '${args.key}' set to '${args.value}'`))
    } else {
      await configManager.setProjectConfig(args.key, args.value)
      this.log(chalk.green(`✓ Project config '${args.key}' set to '${args.value}'`))
    }
  }
}
