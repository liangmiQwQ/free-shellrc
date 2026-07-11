import { execFile } from 'node:child_process'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createShellrcError } from './errors.ts'
import type { Shell } from './shells.ts'

// oxlint-disable-next-line typescript/strict-void-return -- Node provides the callback overload that promisify expects.
const execFileAsync = promisify(execFile)

export async function resolveProfile(shell: Shell): Promise<string> {
  if (shell === 'bash') {
    return join(homeDirectory(), '.bashrc')
  }
  if (shell === 'zsh') {
    return join(environmentPath('ZDOTDIR', homeDirectory()), '.zshrc')
  }
  if (shell === 'fish') {
    const defaultConfig = join(homeDirectory(), '.config')
    return join(environmentPath('XDG_CONFIG_HOME', defaultConfig), 'fish', 'config.fish')
  }
  if (shell === 'powershell' && platform() !== 'win32') {
    throw unavailableShell(shell)
  }

  const executable = shell === 'powershell' ? 'powershell.exe' : 'pwsh'
  try {
    const stdout = await queryProfile(executable)
    const profile = stdout.trim()
    if (!profile) {
      throw new Error('The shell returned an empty profile path.')
    }
    return profile
  } catch (error) {
    throw createShellrcError(
      'ERR_UNAVAILABLE_SHELL',
      `The ${shell} executable is unavailable or could not resolve its profile.`,
      { cause: error }
    )
  }
}

function homeDirectory(): string {
  return environmentPath('HOME', homedir())
}

function environmentPath(name: string, fallback: string): string {
  const value = process.env[name]
  return value?.length ? value : fallback
}

function queryProfile(executable: string): Promise<string> {
  return execFileAsync(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserAllHosts'],
    { encoding: 'utf8', windowsHide: true }
  ).then(result => result.stdout)
}

function unavailableShell(shell: Shell) {
  return createShellrcError(
    'ERR_UNAVAILABLE_SHELL',
    `The ${shell} shell is unavailable on this operating system.`
  )
}
