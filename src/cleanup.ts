import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

import cleanupScriptSource from './cleanup.cjs?raw'
import type { Shell } from './shells.ts'

export async function installCleanupScript(
  packageName: string,
  shell: Shell,
  profilePath: string
): Promise<string> {
  const directory = join(resolveStateDirectory(), `${encodeURIComponent(packageName)}-shellrc`)
  const profileIdentity = createHash('sha256').update(profilePath).digest('hex').slice(0, 16)
  const cleanupPath = join(directory, `cleanup-${shell}-${profileIdentity}.cjs`)
  const source = Buffer.from(cleanupScriptSource)

  await mkdir(directory, { mode: 0o700, recursive: true })
  try {
    if ((await readFile(cleanupPath)).equals(source)) {
      return cleanupPath
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  await writeFile(cleanupPath, source, { mode: 0o600 })
  return cleanupPath
}

function resolveStateDirectory(): string {
  if (platform() === 'win32') {
    return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support')
  }
  return process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
}
