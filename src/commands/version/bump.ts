import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import {execSync} from 'node:child_process'

import VersionSync from './sync.js'

// @ts-ignore - oclif v4 has internal typing incompatibility issues with arg definitions
export default class VersionBump extends Command {
  static args = {
    type: {
      description: 'Version bump type (major, minor, patch)',
      name: 'type',
      options: ['major', 'minor', 'patch'],
      required: true,
    },
  } as const

  static description = 'Bump version and sync to env files'
  static flags = {
    'git-tag-version': Flags.boolean({
      allowNo: true,
      default: false, // Default to false as per legacy script behavior
      description: 'Create a git tag',
    }),
  }

  async run(): Promise<void> {
    // @ts-ignore - oclif typing issue with parse method
    const {args, flags} = await this.parse(VersionBump)

    const typedArgs = args as {type: string}
    this.log(chalk.magenta(`[0] Bumping version (${typedArgs.type})...`))

    try {
      const gitTagFlag = flags['git-tag-version'] ? '' : '--no-git-tag-version'
      execSync(`npm version ${typedArgs.type} ${gitTagFlag}`, {cwd: process.cwd(), stdio: 'inherit'})

      // After bumping, run sync
      // We can invoke the command helper or run the logic.
      // Invoking the command class directly is acceptable in Oclif if structured right,
      // but calling the run method manually can be tricky with parsing.
      // Easier to just spawn it or duplicate the sync logic call?
      // Better: Instantiate VersionSync and run it.

      // Actually, let's just use execSync to call our own CLI or just use the sync logic if we exported it?
      // Since we are inside the CLI, we can't easily "exec" ourselves without knowing the bin name.
      // But we can import the run method.

      // Let's just run the sync command logic logic via a shared service?
      // Or just exec `npm run sync-version` if the user has it? NO, we want to replace the scripts.

      // I will just spawn the sync command using Oclif's Config.runCommand is complicated.
      // SImple approach: `await VersionSync.run(['--bump'])` (handles args parsing again)

      this.log(chalk.green('[1] Syncing version to env files...'))
      await VersionSync.run(['--bump']) // Sync all envs and bump codes
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.error(errorMessage)
    }
  }
}
