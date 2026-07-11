import { CLEANUP_SCRIPT } from './cleanup.ts'
import type { Markers } from './transform.ts'

export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh'

export function createManagedBlock(
  shell: Shell,
  command: string,
  productName: string,
  profilePath: string,
  markers: Markers,
  lineEnding: string
): string {
  const normalizedCommand = command.replaceAll(/\r\n|\n|\r/g, lineEnding)
  const cleanupScript = CLEANUP_SCRIPT.replaceAll(/\r\n|\n|\r/g, ';')
  const lines =
    shell === 'fish'
      ? createFishLines(normalizedCommand, productName, profilePath, markers, cleanupScript)
      : shell === 'powershell' || shell === 'pwsh'
        ? createPowerShellLines(normalizedCommand, productName, profilePath, markers, cleanupScript)
        : createPosixLines(normalizedCommand, productName, profilePath, markers, cleanupScript)

  return [markers.start, ...lines, markers.end, ''].join(lineEnding)
}

function createPosixLines(
  command: string,
  productName: string,
  profilePath: string,
  markers: Markers,
  cleanupScript: string
): string[] {
  return [
    `if command -v -- ${quotePosix(productName)} >/dev/null 2>&1; then`,
    command,
    'else',
    `  command node -e ${quotePosix(cleanupScript)} ${quotePosix(profilePath)} ${quotePosix(markers.start)} ${quotePosix(markers.end)} >/dev/null 2>&1 || true`,
    'fi'
  ]
}

function createFishLines(
  command: string,
  productName: string,
  profilePath: string,
  markers: Markers,
  cleanupScript: string
): string[] {
  return [
    `if command --query ${quotePosix(productName)}`,
    command,
    'else',
    `  command node -e ${quotePosix(cleanupScript)} ${quotePosix(profilePath)} ${quotePosix(markers.start)} ${quotePosix(markers.end)} >/dev/null 2>&1; or true`,
    'end'
  ]
}

function createPowerShellLines(
  command: string,
  productName: string,
  profilePath: string,
  markers: Markers,
  cleanupScript: string
): string[] {
  return [
    `if (Get-Command -Name ${quotePowerShell(productName)} -ErrorAction SilentlyContinue) {`,
    command,
    '} else {',
    '  try {',
    `    & node -e ${quotePowerShell(cleanupScript)} ${quotePowerShell(profilePath)} ${quotePowerShell(markers.start)} ${quotePowerShell(markers.end)} *> $null`,
    '  } catch {}',
    '}'
  ]
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
