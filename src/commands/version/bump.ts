import {Command, Flags} from '@oclif/core'
import {execSync} from 'child_process'
import chalk from 'chalk'
import VersionSync from './sync.js'

export default class VersionBump extends Command {
  static description = 'Bump version and sync to env files'

  static args = {
    type: {
      name: 'type',
      description: 'Version bump type (major, minor, patch)',
      required: true,
      options: ['major', 'minor', 'patch'],
    },
  }

  static flags = {
    'git-tag-version': Flags.boolean({
      description: 'Create a git tag',
      default: false, // Default to false as per legacy script behavior
      allowNo: true,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(VersionBump)

    this.log(chalk.magenta(`[0] Bumping version (${args.type})...`))

    try {
      const gitTagFlag = flags['git-tag-version'] ? '' : '--no-git-tag-version'
      execSync(`npm version ${args.type} ${gitTagFlag}`, {stdio: 'inherit', cwd: process.cwd()})

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
    } catch (error: any) {
      this.error(error.message)
    }
  }
}
