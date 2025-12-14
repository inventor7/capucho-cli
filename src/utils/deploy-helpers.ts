import {execSync} from 'child_process'
import path from 'path'
import fs from 'fs-extra'
import axios from 'axios'
import FormData from 'form-data'
import chalk from 'chalk'
import ora from 'ora'

export interface DeployConfig {
  env: string
  platform: string
  type: 'ota' | 'native'
  channel?: string
  version?: string
  note?: string
  required: boolean
  active: boolean
  skipAsset?: boolean
}

export function runCommand(cmd: string, cwd: string = process.cwd(), silent: boolean = false) {
  try {
    execSync(cmd, {
      cwd,
      stdio: silent ? 'pipe' : 'inherit',
      encoding: 'utf8',
    })
  } catch (error: any) {
    if (!silent) {
      console.error(chalk.red(`Command failed: ${cmd}`))
    }
    throw new Error(`Command failed: ${cmd}`)
  }
}

export async function runBuildSteps(config: DeployConfig, root: string) {
  const {env, platform, skipAsset} = config

  // Step 1.5: Asset Generation
  if (!skipAsset) {
    console.log(chalk.green(`[1.5] Generating assets for ${env}...`))
    runCommand(`npm run assets:${env}`, root)
  }

  // Step 2: Build
  console.log(chalk.green(`[2] Building for ${env}...`))
  // Check if script exists, fallback to vite build if not? NO, user has build scripts.
  runCommand(`pnpm build:${env}`, root)

  // Step 3: Trapeze
  console.log(chalk.green(`[3] Running Trapeze...`))
  runCommand(`pnpm trapeze:${env}`, root)

  // Step 4: Capacitor Sync
  console.log(chalk.green(`[4] Syncing Capacitor...`))
  runCommand(`npx cap sync ${platform}`, root)
}

export function findLatestZip(root: string) {
  const files = fs
    .readdirSync(root)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => ({
      name: f,
      path: path.join(root, f),
      time: fs.statSync(path.join(root, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time)

  return files[0] || null
}

export async function uploadFile(url: string, filePath: string, formDataFields: Record<string, any>, apiKey?: string) {
  const form = new FormData()

  // Add file
  form.append(formDataFields.fileField || 'file', fs.createReadStream(filePath))

  // Add other fields
  for (const [key, value] of Object.entries(formDataFields.fields)) {
    if (value !== null && value !== undefined) {
      form.append(key, value)
    }
  }

  // Headers
  const headers = {
    ...form.getHeaders(),
    ...(apiKey ? {Authorization: `Bearer ${apiKey}`} : {}), // Example auth header if needed
  }

  try {
    const response = await axios.post(url, form, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })
    return {success: true, data: response.data, status: response.status}
  } catch (error: any) {
    return {
      success: false,
      status: error.response?.status || 0,
      data: error.response?.data || error.message,
    }
  }
}
