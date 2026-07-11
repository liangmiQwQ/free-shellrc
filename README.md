# free-shellrc

Safely install product-owned shell integration in the current user's Bash, Zsh, Fish, Windows PowerShell, and PowerShell 7 profiles.

`free-shellrc` owns only a clearly marked block. It preserves the rest of the profile, including its encoding, line endings, permissions, and symbolic link. Calling it repeatedly with the same commands does not rewrite the profile.

## Why free-shellrc

- **Self-cleaning after uninstall.** Each managed block checks whether its owning package still exists. If the package has been removed, the block skips the product command and removes itself from that profile. The cleanup helper then removes itself too.
- **Enforced first restart.** A first-time installation creates a restart marker. `shellrcGuard` rejects later application invocations with `ERR_SHELL_RESTART_REQUIRED` until a new shell loads the managed block. Explicitly reloading the profile also satisfies this requirement.
- **User-owned content stays user-owned.** Installation changes only the marked region and preserves content outside it byte for byte, along with the existing encoding, line endings, permissions, and symbolic link.
- **Safe to repeat and update.** Reinstalling identical commands does not rewrite the profile. Changed commands replace the existing block in place, and malformed or concurrently changed profiles are not overwritten.

The self-cleaning path requires `node` to remain available on `PATH`. Cleanup failures are ignored during shell startup so they cannot prevent the rest of the user's profile from loading.

## Install

```sh
vp install free-shellrc
```

## Use

Pass a shell-specific command factory. By default, the library installs only for the shell that is currently running:

```ts
import { installShellrc, shellrcGuard } from 'free-shellrc'

shellrcGuard(import.meta.url)

const changed = await installShellrc(shellType => {
  if (shellType === 'fish') {
    return 'acme shell-init fish | source'
  }
  if (shellType === 'powershell' || shellType === 'pwsh') {
    return `acme shell-init ${shellType} | Invoke-Expression`
  }
  return `eval "$(acme shell-init ${shellType})"`
})

if (changed) {
  console.log('Restart your shell or reload its profile to use the integration.')
}
```

Pass a second argument such as `['bash', 'zsh', 'fish']` to install for an explicit set of shells. The command factory runs once for each selected shell. The promise resolves to `true` if at least one profile changed and `false` if every selected profile already contained the same managed block.

Call `shellrcGuard(import.meta.url)` at the top of the complete application entry, before other application code. The entry must belong to a package with a stable `name`. The guard rejects unsupported shells and, after the first installation, stops later invocations until a restarted shell or explicitly reloaded profile loads the managed block once.

## Shell support

The public shell identifiers are:

```ts
type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh'
```

| Shell                      | Identifier   | Support                                                                                     |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| Bash                       | `bash`       | Supported on macOS and Linux. Git Bash is supported when it loads `~/.bashrc`.              |
| Zsh                        | `zsh`        | Supported on macOS and Linux.                                                               |
| Fish                       | `fish`       | Supported on macOS and Linux.                                                               |
| Windows PowerShell 5.1     | `powershell` | Supported on Windows only.                                                                  |
| PowerShell 7+              | `pwsh`       | Supported wherever the `pwsh` executable is available.                                      |
| Command Prompt (`cmd.exe`) | —            | **Not supported.** `free-shellrc` does not edit Command Processor AutoRun registry entries. |
| Other shells               | —            | **Not supported.** This includes shells without one of the identifiers above.               |

The requested executable must be available. PowerShell profile paths are queried from that executable so redirected Documents folders and host-specific paths are respected; execution policy still applies.

WSL is a separate Linux environment: install the integration from inside each WSL distribution that should receive it. System-wide and all-user profiles are not supported.

## Before installing

- Ask for consent if your product requires it. This library does not prompt.
- Return valid shell-specific code without generated marker lines. The library does not translate or validate commands.
- Tell users to restart their shell or reload the profile after a changed installation. `free-shellrc` cannot modify the state of an already-running parent shell.

If the guarded entry or package manifest disappears, the local cleanup helper removes the stale block while preserving the rest of the profile.

## Errors

Expected conflicts are normal `Error` objects with a stable `code` property. The exported `ShellrcErrorCode` type contains:

| Code                            | Meaning                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ERR_INVALID_MARKERS`           | A profile or caller command contains incomplete, reversed, nested, or conflicting markers.     |
| `ERR_PACKAGE_NOT_FOUND`         | The guarded entry has no ancestor `package.json` with a package name.                          |
| `ERR_SHELL_RESTART_REQUIRED`    | The first installation has not yet been loaded by a restarted shell or reloaded profile.       |
| `ERR_SHELLRC_GUARD_REQUIRED`    | `installShellrc` was called before `shellrcGuard`.                                             |
| `ERR_UNSUPPORTED_ENCODING`      | An existing profile is not supported UTF-8, UTF-16 LE, or UTF-16 BE.                           |
| `ERR_UNAVAILABLE_SHELL`         | The requested shell executable or profile path is unavailable.                                 |
| `ERR_UNSUPPORTED_SHELL`         | The current terminal is using a shell that the library does not support.                       |
| `ERR_CONCURRENT_PROFILE_CHANGE` | The profile changed between reading and replacement, so the newer content was not overwritten. |

Filesystem and permission failures retain their original error and cause where applicable.

```ts
import { shellrcGuard } from 'free-shellrc'
import type { ShellrcErrorCode } from 'free-shellrc'

shellrcGuard(import.meta.url)

try {
  await installShellrc(shellType => `acme shell-init ${shellType}`, ['pwsh'])
} catch (error) {
  const code = (error as Error & { code?: ShellrcErrorCode }).code
  if (code === 'ERR_UNAVAILABLE_SHELL') {
    // Ask the user to install or deselect the requested shell.
  }
}
```

## Profile locations

| Shell              | Current-user profile                                          |
| ------------------ | ------------------------------------------------------------- |
| Bash               | `$HOME/.bashrc`                                               |
| Zsh                | `${ZDOTDIR:-$HOME}/.zshrc`                                    |
| Fish               | `${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish`          |
| Windows PowerShell | `$PROFILE.CurrentUserAllHosts`, queried from `powershell.exe` |
| PowerShell 7+      | `$PROFILE.CurrentUserAllHosts`, queried from `pwsh`           |

Existing UTF-8, UTF-8 BOM, UTF-16 LE BOM, and UTF-16 BE BOM profiles retain their encoding. New Windows PowerShell 5.1 profiles use UTF-8 with a BOM; other new profiles use UTF-8 without a BOM.

## License

[MIT](./LICENSE) © Liang Mi
