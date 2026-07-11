import { decodeProfile, encodeProfile } from './encoding.ts'
import { createShellrcError } from './errors.ts'
import { readProfile, writeProfile } from './file.ts'
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

export async function installShellrc<RequestedShell extends Shell>(
  shellCommand: Record<RequestedShell, string>,
  productName: string
): Promise<boolean> {
  validateProductName(productName)

  let changed = false
  for (const [shell, command] of Object.entries(shellCommand) as [RequestedShell, string][]) {
    const profilePath = await resolveProfile(shell)
    const profile = await readProfile(profilePath)
    const decoded = decodeProfile(profile.bytes)
    const markers = createMarkers(productName)
    assertCommandDoesNotContainMarkers(command, markers)
    const lineEnding = detectLineEnding(decoded.text)
    const block = createManagedBlock(shell, command, productName, profilePath, markers, lineEnding)
    const updated = transformProfile(decoded.text, markers, block)
    const encoding =
      profile.mode === undefined && shell === 'powershell' ? 'utf8-bom' : decoded.encoding
    const bytes = encodeProfile(updated, encoding)

    if (bytes.equals(profile.bytes)) {
      continue
    }
    await writeProfile(profile, bytes)
    changed = true
  }
  return changed
}

function validateProductName(productName: string): void {
  if (/^[A-Za-z0-9._-]+$/.test(productName)) {
    return
  }
  throw createShellrcError(
    'ERR_INVALID_PRODUCT_NAME',
    'productName must contain only ASCII letters, digits, periods, underscores, and hyphens.'
  )
}
