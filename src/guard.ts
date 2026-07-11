import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createShellrcError } from './errors.ts'
import type { Shell } from './shells.ts'

export interface ShellrcContext {
  entryPath: string
  packageName: string
  packagePath: string
  restartPath: string
  shell: Shell
}

let activeContext: ShellrcContext | undefined

export function shellrcGuard(entry: string | URL): void {
  activeContext = undefined
  const entryPath = resolveEntryPath(entry)
  const packageMetadata = findPackageMetadata(entryPath)
  const shell = detectCurrentShell()
  if (!shell) {
    throw createShellrcError(
      'ERR_UNSUPPORTED_SHELL',
      'The current terminal is not using Bash, Zsh, Fish, Windows PowerShell, or PowerShell 7.'
    )
  }

  const restartPath = createRestartPath(packageMetadata.name)
  activeContext = {
    entryPath,
    packageName: packageMetadata.name,
    packagePath: packageMetadata.path,
    restartPath,
    shell
  }
  if (existsSync(restartPath)) {
    throw createShellrcError(
      'ERR_SHELL_RESTART_REQUIRED',
      'Restart the current shell before running this command again.'
    )
  }
}

export function requireShellrcContext(): ShellrcContext {
  if (activeContext) {
    return activeContext
  }
  throw createShellrcError(
    'ERR_SHELLRC_GUARD_REQUIRED',
    'Call shellrcGuard(import.meta.url) at the top of the application entry before using free-shellrc.'
  )
}

function createRestartPath(packageName: string): string {
  const identity = createHash('sha256').update(packageName).digest('hex').slice(0, 24)
  return join(tmpdir(), `.free-shellrc-${identity}.restart`)
}

function detectCurrentShell(): Shell | undefined {
  const parentShell = platform() === 'win32' ? detectWindowsParentShell() : detectPosixParentShell()
  return parentShell ?? shellFromExecutable(process.env.SHELL)
}

function detectPosixParentShell(): Shell | undefined {
  try {
    const executable = execFileSync('ps', ['-p', String(process.ppid), '-o', 'comm='], {
      encoding: 'utf8'
    }).trim()
    return shellFromExecutable(executable)
  } catch {
    return undefined
  }
}

function detectWindowsParentShell(): Shell | undefined {
  try {
    const command = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.ppid}').Name`
    const executable = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', windowsHide: true }
    ).trim()
    return shellFromExecutable(executable)
  } catch {
    return undefined
  }
}

function shellFromExecutable(executable: string | undefined): Shell | undefined {
  if (!executable) {
    return undefined
  }
  const name = basename(executable)
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (name === 'bash' || name === 'zsh' || name === 'fish' || name === 'pwsh') {
    return name
  }
  return name === 'powershell' ? 'powershell' : undefined
}

function resolveEntryPath(entry: string | URL): string {
  return resolve(entry instanceof URL ? fileURLToPath(entry) : entry)
}

function findPackageMetadata(entryPath: string): { name: string; path: string } {
  const entryDirectory = dirname(entryPath)
  const { root } = parse(entryDirectory)

  for (let directory = entryDirectory; ; directory = dirname(directory)) {
    const packagePath = join(directory, 'package.json')
    if (existsSync(packagePath)) {
      const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown }
      if (typeof manifest.name === 'string' && manifest.name.length > 0) {
        return { name: manifest.name, path: packagePath }
      }
      return packageNotFound(entryPath)
    }
    if (directory === root) {
      return packageNotFound(entryPath)
    }
  }
}

function packageNotFound(entryPath: string): never {
  throw createShellrcError(
    'ERR_PACKAGE_NOT_FOUND',
    `Could not find a package.json with a name for the application entry: ${entryPath}`
  )
}
