import axios from 'axios'
import chalk from 'chalk'
import FormData from 'form-data'
import fs from 'fs-extra'
import {execSync} from 'node:child_process'
import path from 'node:path'

export interface DeployConfig {
  active: boolean
  channel?: string
  env: string
  flavor?: string
  note?: string
  platform: string
  required: boolean
  skipAsset?: boolean
  type: 'native' | 'ota'
  version?: string
}

export function runCommand(cmd: string, cwd: string = process.cwd(), silent: boolean = false) {
  try {
    execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit',
    })
  } catch {
    if (!silent) {
      console.error(chalk.red(`Command failed: ${cmd}`))
    }

    throw new Error(`Command failed: ${cmd}`)
  }
}

export async function runBuildSteps(config: DeployConfig, root: string) {
  const {env, flavor, platform, skipAsset} = config

  // Construct paths for flavor if needed
  let envPath = `build/${env}/.env.${env}`
  let trapezePath = `build/${env}/trapeze.${env}.yaml`

  if (flavor) {
    envPath = `build/flavors/${flavor}/${env}/.env.${env}`
    trapezePath = `build/flavors/${flavor}/${env}/trapeze.${env}.yaml`
  }

  // Step 1.5: Asset Generation
  if (!skipAsset) {
    console.log(chalk.green(`[1.5] Generating assets for ${env}...`))
    runCommand(`npm run assets:${env}`, root)
  }

  // Step 2: Build
  console.log(chalk.green(`[2] Building for ${env} ${flavor ? `(${flavor})` : ''}...`))

  if (flavor) {
    // Dynamic command for flavor
    runCommand(`npx dotenv -e ${envPath} -- vite build`, root)
  } else {
    // Standard script
    runCommand(`pnpm build:${env}`, root)
  }

  // Step 3: Trapeze
  console.log(chalk.green(`[3] Running Trapeze...`))
  if (flavor) {
    runCommand(`npx dotenv -e ${envPath} -- trapeze run ${trapezePath} -y`, root)
  } else {
    runCommand(`pnpm trapeze:${env}`, root)
  }

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

export async function uploadFile(
  url: string,
  filePath: string,
  formDataFields: {
    fields: Record<string, boolean | number | string>
    fileField?: string
  },
  apiKey?: string,
) {
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
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })
    return {data: response.data, status: response.status, success: true}
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    // Type assertion for axios error response
    const axiosError = error as {response?: {data: unknown; status: number}}
    return {
      data: axiosError.response?.data || errorMessage,
      status: axiosError.response?.status || 0,
      success: false,
    }
  }
}
