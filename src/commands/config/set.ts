import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import {ConfigManager} from '../../utils/config.js'

// @ts-ignore - oclif v4 has internal typing incompatibility issues with arg definitions
export default class ConfigSet extends Command {
  static args = {
    key: {
      description: 'Config key (e.g. apiKey, defaultEnvironment)',
      name: 'key',
      required: true,
    },
    value: {
      description: 'Config value',
      name: 'value',
      required: true,
    },
  } as const

  static description = 'Set a configuration value'
  static flags = {
    global: Flags.boolean({char: 'g', default: false, description: 'Set in global config'}),
  }

  async run(): Promise<void> {
    // @ts-ignore - oclif typing issue with parse method
    const {args, flags} = await this.parse(ConfigSet)
    const configManager = new ConfigManager(process.cwd())

    const typedArgs = args as {key: string; value: string}
    if (flags.global) {
      await configManager.setGlobalConfig(typedArgs.key, typedArgs.value)
      this.log(chalk.green(`✓ Global config '${typedArgs.key}' set to '${typedArgs.value}'`))
    } else {
      await configManager.setProjectConfig(typedArgs.key, typedArgs.value)
      this.log(chalk.green(`✓ Project config '${typedArgs.key}' set to '${typedArgs.value}'`))
    }
  }
}
