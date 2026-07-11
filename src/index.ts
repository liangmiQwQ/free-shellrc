import { writeFile } from 'node:fs/promises'

import { installCleanupScript } from './cleanup.ts'
import { decodeProfile, encodeProfile } from './encoding.ts'
import { readProfile, writeProfile } from './file.ts'
import { requireShellrcContext } from './guard.ts'
import { resolveProfile } from './profiles.ts'
import { createManagedBlock } from './shells.ts'
import type { Shell } from './shells.ts'
import {
  assertCommandDoesNotContainMarkers,
  createMarkers,
  detectLineEnding,
  transformProfile
} from './transform.ts'

export type { Shell } from './shells.ts'
export type { ShellrcErrorCode } from './errors.ts'
export { shellrcGuard } from './guard.ts'

export async function installShellrc(
  commands: (shellType: Shell) => string,
  shell?: Shell[]
): Promise<boolean> {
  const context = requireShellrcContext()
  const requestedShells = shell ?? [context.shell]

  let changed = false
  for (const shellType of requestedShells) {
    const command = commands(shellType)
    const profilePath = await resolveProfile(shellType)
    const profile = await readProfile(profilePath)
    const decoded = decodeProfile(profile.bytes)
    const markers = createMarkers(context.packageName)
    assertCommandDoesNotContainMarkers(command, markers)
    const lineEnding = detectLineEnding(decoded.text)
    const firstInstall = !decoded.text.split(/\r\n|\n|\r/).includes(markers.start)
    const cleanupPath = await installCleanupScript(context.packageName, shellType, profilePath)
    const block = createManagedBlock(
      shellType,
      command,
      context.entryPath,
      context.packagePath,
      profilePath,
      context.restartPath,
      cleanupPath,
      markers,
      lineEnding
    )
    const updated = transformProfile(decoded.text, markers, block)
    const encoding =
      profile.mode === undefined && shellType === 'powershell' ? 'utf8-bom' : decoded.encoding
    const bytes = encodeProfile(updated, encoding)

    if (bytes.equals(profile.bytes)) {
      continue
    }
    await writeProfile(profile, bytes)
    if (firstInstall) {
      await createRestartMarker(context.restartPath)
    }
    changed = true
  }
  return changed
}

async function createRestartMarker(path: string): Promise<void> {
  try {
    await writeFile(path, '', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
}
