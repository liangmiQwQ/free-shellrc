export type ShellrcErrorCode =
  | 'ERR_CONCURRENT_PROFILE_CHANGE'
  | 'ERR_INVALID_MARKERS'
  | 'ERR_SHELLRC_GUARD_REQUIRED'
  | 'ERR_UNAVAILABLE_SHELL'
  | 'ERR_UNSUPPORTED_ENCODING'

export type ShellrcError = Error & { code: ShellrcErrorCode }

export function createShellrcError(
  code: ShellrcErrorCode,
  message: string,
  options?: ErrorOptions
): ShellrcError {
  return Object.assign(new Error(message, options), { code })
}
