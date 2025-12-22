import fs from 'fs-extra'
import path from 'node:path'

export async function syncVersion(root: string, env: string, bump: boolean = false) {
  const packageJsonPath = path.join(root, 'package.json')
  if (!(await fs.pathExists(packageJsonPath))) {
    throw new Error('package.json not found')
  }

  const packageJson = await fs.readJson(packageJsonPath)
  const {version} = packageJson

  const versionCodePath = path.join(root, 'version-code.json')
  let versionCodes: Record<string, number> = {dev: 1, prod: 1, staging: 1}

  if (await fs.pathExists(versionCodePath)) {
    versionCodes = await fs.readJson(versionCodePath)
  }

  const envFiles: Record<string, string> = {
    dev: path.join(root, 'build/dev/.env.dev'),
    prod: path.join(root, 'build/prod/.env.prod'),
    staging: path.join(root, 'build/staging/.env.staging'),
  }

  const envPath = envFiles[env]
  if (!envPath || !(await fs.pathExists(envPath))) {
    throw new Error(`Env file for ${env} not found at ${envPath}`)
  }

  if (bump) {
    versionCodes[env] = (versionCodes[env] || 0) + 1
  }

  let content = await fs.readFile(envPath, 'utf8')
  const versionCode = versionCodes[env]

  if (content.includes('VITE_APP_VERSION=')) {
    content = content.replaceAll(/VITE_APP_VERSION=.*/g, `VITE_APP_VERSION=${version}`)
  }
  if (content.includes('VERSION_CODE=')) {
    content = content.replaceAll(/VERSION_CODE=.*/g, `VERSION_CODE=${versionCode}`)
  }
  if (content.includes('BUILD_NUMBER=')) {
    content = content.replaceAll(/BUILD_NUMBER=.*/g, `BUILD_NUMBER=${versionCode}`)
  }

  await fs.writeFile(envPath, content)
  await fs.writeJson(versionCodePath, versionCodes, {spaces: 2})

  return {version, versionCode}
}
