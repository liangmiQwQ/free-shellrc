import { randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { createShellrcError } from './errors.ts'

interface ProfileFile {
  bytes: Buffer
  mode: number | undefined
  targetPath: string
}

export async function readProfile(profilePath: string): Promise<ProfileFile> {
  const targetPath = await resolveTarget(profilePath)
  try {
    const [bytes, metadata] = await Promise.all([readFile(targetPath), stat(targetPath)])
    return { bytes, mode: metadata.mode, targetPath }
  } catch (error) {
    if (isNotFound(error)) {
      return { bytes: Buffer.alloc(0), mode: undefined, targetPath }
    }
    throw error
  }
}

export async function writeProfile(profile: ProfileFile, bytes: Buffer): Promise<void> {
  await mkdir(dirname(profile.targetPath), { recursive: true })
  const temporaryPath = join(
    dirname(profile.targetPath),
    `.free-shellrc-${randomBytes(8).toString('hex')}`
  )

  try {
    await writeFile(temporaryPath, bytes, {
      flag: 'wx',
      mode: profile.mode
    })
    if (profile.mode !== undefined) {
      await chmod(temporaryPath, profile.mode)
    }
    await assertUnchanged(profile)
    await rename(temporaryPath, profile.targetPath)
  } finally {
    await removeTemporary(temporaryPath)
  }
}

async function removeTemporary(temporaryPath: string): Promise<boolean> {
  try {
    await unlink(temporaryPath)
    return true
  } catch {
    return false
  }
}

async function resolveTarget(profilePath: string): Promise<string> {
  try {
    const metadata = await lstat(profilePath)
    if (!metadata.isSymbolicLink()) {
      return profilePath
    }
    try {
      const targetPath = await realpath(profilePath)
      return targetPath
    } catch (error) {
      if (!isNotFound(error)) {
        throw error
      }
      const destination = await readlink(profilePath)
      return isAbsolute(destination) ? destination : resolve(dirname(profilePath), destination)
    }
  } catch (error) {
    if (isNotFound(error)) {
      return profilePath
    }
    throw error
  }
}

async function assertUnchanged(profile: ProfileFile): Promise<void> {
  try {
    const current = await readFile(profile.targetPath)
    if (current.equals(profile.bytes) && profile.mode !== undefined) {
      return
    }
  } catch (error) {
    if (isNotFound(error) && profile.mode === undefined) {
      return
    }
    if (!isNotFound(error)) {
      throw error
    }
  }

  throw createShellrcError(
    'ERR_CONCURRENT_PROFILE_CHANGE',
    `The shell profile changed while it was being updated: ${profile.targetPath}`
  )
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
