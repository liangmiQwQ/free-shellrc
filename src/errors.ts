export type ShellrcErrorCode =
  | 'ERR_CONCURRENT_PROFILE_CHANGE'
  | 'ERR_INVALID_MARKERS'
  | 'ERR_PACKAGE_NOT_FOUND'
  | 'ERR_SHELL_RESTART_REQUIRED'
  | 'ERR_SHELLRC_GUARD_REQUIRED'
  | 'ERR_UNAVAILABLE_SHELL'
  | 'ERR_UNSUPPORTED_SHELL'
  | 'ERR_UNSUPPORTED_ENCODING'

export type ShellrcError = Error & { code?: string }

export function createShellrcError(
  code: ShellrcErrorCode,
  message: string,
  options?: ErrorOptions
): ShellrcError & { code: ShellrcErrorCode } {
  return Object.assign(new Error(message, options), { code })
}

export function normalizeShellrcError(error: unknown): ShellrcError {
  return error instanceof Error ? error : new Error(String(error), { cause: error })
}
