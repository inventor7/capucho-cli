import cliProgress from 'cli-progress'
import ora, {Ora} from 'ora'
import chalk from 'chalk'

export class MultiStepProgress {
  private multibar: cliProgress.MultiBar
  private progressBar: cliProgress.SingleBar | null = null
  private spinner: Ora
  private totalSteps: number = 0
  private currentStep: number = 0

  constructor() {
    this.multibar = new cliProgress.MultiBar(
      {
        hideCursor: true,
        format: ` {bar} | {percentage}% | {value}/{total} Steps | ${chalk.cyan('{message}')}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      },
      cliProgress.Presets.shades_classic,
    )

    this.spinner = ora()
  }

  start(totalSteps: number, initialMessage: string) {
    this.totalSteps = totalSteps
    this.currentStep = 1
    this.progressBar = this.multibar.create(totalSteps, 1, {message: initialMessage})
    this.spinner.start(initialMessage)
  }

  nextStep(message: string) {
    // Persist previous step as success
    this.spinner.succeed(chalk.green(this.spinner.text))

    this.currentStep++
    if (this.progressBar) {
      this.progressBar.update(this.currentStep, {message})
    }

    // Start new spinner for current step
    this.spinner = ora().start(message)
  }

  updateMessage(message: string) {
    if (this.progressBar) {
      this.progressBar.update(this.currentStep, {message})
    }
    this.spinner.text = message
  }

  finish(message: string) {
    this.spinner.succeed(chalk.green(this.spinner.text))
    if (this.progressBar) {
      this.progressBar.update(this.totalSteps, {message})
    }
    this.multibar.stop()
    console.log('\n' + chalk.green('✓ ' + message))
  }

  fail(message: string) {
    this.spinner.fail(chalk.red(this.spinner.text))
    this.multibar.stop()
    console.error('\n' + chalk.red('✖ ' + message))
  }
}
