import type { Markers } from './transform.ts'

export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh'

export function createManagedBlock(
  shell: Shell,
  command: string,
  entryPath: string,
  packagePath: string,
  profilePath: string,
  restartPath: string,
  cleanupPath: string,
  markers: Markers,
  lineEnding: string
): string {
  const normalizedCommand = command.replaceAll(/\r\n|\n|\r/g, lineEnding)
  const warning = `# Please do not edit the comments \`${markers.start}\`, \`${markers.end}\` and the script between them, which probably makes ${markers.packageName}'s feature broken.`
  const lines =
    shell === 'fish'
      ? createFishLines(
          normalizedCommand,
          entryPath,
          packagePath,
          profilePath,
          restartPath,
          cleanupPath,
          markers
        )
      : shell === 'powershell' || shell === 'pwsh'
        ? createPowerShellLines(
            normalizedCommand,
            entryPath,
            packagePath,
            profilePath,
            restartPath,
            cleanupPath,
            markers
          )
        : createPosixLines(
            normalizedCommand,
            entryPath,
            packagePath,
            profilePath,
            restartPath,
            cleanupPath,
            markers
          )

  return [markers.start, warning, ...lines, markers.end, ''].join(lineEnding)
}

function createPosixLines(
  command: string,
  entryPath: string,
  packagePath: string,
  profilePath: string,
  restartPath: string,
  cleanupPath: string,
  markers: Markers
): string[] {
  return [
    `if [ -f ${quotePosix(entryPath)} ] && [ -f ${quotePosix(packagePath)} ]; then`,
    `  command rm -f -- ${quotePosix(restartPath)} >/dev/null 2>&1 || true`,
    command,
    'else',
    `  command node ${quotePosix(cleanupPath)} ${quotePosix(profilePath)} ${quotePosix(markers.start)} ${quotePosix(markers.end)} >/dev/null 2>&1 || true`,
    'fi'
  ]
}

function createFishLines(
  command: string,
  entryPath: string,
  packagePath: string,
  profilePath: string,
  restartPath: string,
  cleanupPath: string,
  markers: Markers
): string[] {
  return [
    `if test -f ${quotePosix(entryPath)}; and test -f ${quotePosix(packagePath)}`,
    `  command rm -f -- ${quotePosix(restartPath)} >/dev/null 2>&1; or true`,
    command,
    'else',
    `  command node ${quotePosix(cleanupPath)} ${quotePosix(profilePath)} ${quotePosix(markers.start)} ${quotePosix(markers.end)} >/dev/null 2>&1; or true`,
    'end'
  ]
}

function createPowerShellLines(
  command: string,
  entryPath: string,
  packagePath: string,
  profilePath: string,
  restartPath: string,
  cleanupPath: string,
  markers: Markers
): string[] {
  return [
    `if ((Test-Path -LiteralPath ${quotePowerShell(entryPath)} -PathType Leaf) -and (Test-Path -LiteralPath ${quotePowerShell(packagePath)} -PathType Leaf)) {`,
    `  Remove-Item -LiteralPath ${quotePowerShell(restartPath)} -Force -ErrorAction SilentlyContinue`,
    command,
    '} else {',
    '  try {',
    `    & node ${quotePowerShell(cleanupPath)} ${quotePowerShell(profilePath)} ${quotePowerShell(markers.start)} ${quotePowerShell(markers.end)} *> $null`,
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
