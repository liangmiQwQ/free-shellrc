# free-shellrc

Safely install product-owned shell integration in the current user's Bash, Zsh, Fish, Windows PowerShell, and PowerShell 7 profiles.

`free-shellrc` owns only a clearly marked block. It preserves the rest of the profile, including its encoding, line endings, permissions, and symbolic link. Calling it repeatedly with the same commands does not rewrite the profile.

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

Call `shellrcGuard(import.meta.url)` at the top of the complete application entry, before other application code. The guard rejects unsupported shells. After the first managed block is installed, it also stops later invocations until the shell loads that block once. Loading the block removes a temporary restart marker, so users must restart the shell before running the application again.

The supported shell identifiers are:

```ts
type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh'
```

`powershell` selects Windows PowerShell 5.1 and is available only on Windows. `pwsh` selects PowerShell 7 or newer. PowerShell profile paths are queried from the requested executable so redirected Documents folders and host-specific paths are respected.

## What to pay attention to

- Ask for the user's consent before editing a profile when your product requires it. This library performs the requested installation without prompting.
- Call `shellrcGuard(import.meta.url)` before other application code. The entry must be inside a package with a named `package.json`.
- Omit the shell list to configure only the current shell, or provide a `Shell[]` to configure several profiles explicitly.
- Give the downstream package a stable `name` in `package.json`. The library derives its managed markers from that name and records the guarded entry and manifest paths for stale-installation checks.
- Supply valid code for each shell. Commands are inserted as provided, with only their line endings adapted to the profile; they are not translated or validated as shell syntax.
- Do not include the generated marker lines in a command. Marker conflicts stop the installation without writing the profile.
- Tell users to restart their shell or reload the profile after a changed installation. `free-shellrc` cannot modify the state of an already-running parent shell.
- Keep Node.js available on `PATH`. If either the guarded JavaScript entry or its package manifest later disappears, the generated guard treats the package as uninstalled and uses a readable, unencoded cleanup script to remove the stale block while preserving the profile bytes. Cleanup failures are ignored so they cannot prevent the rest of the profile from loading.
- The cleanup program is maintained as a standalone JavaScript file and embedded into the library bundle and generated managed block. Shell startup does not depend on that source file remaining installed.
- Handle unavailable requested shells. In particular, requesting `pwsh` requires the `pwsh` executable, and requesting `powershell` requires Windows PowerShell on Windows.
- PowerShell execution policy is outside this library's scope. A successfully updated profile may still be blocked by the user's policy.
- WSL is a separate Linux environment. Git Bash can use the `bash` adapter when it loads `~/.bashrc`.

## Errors

Expected conflicts are normal `Error` objects with a stable `code` property. The exported `ShellrcErrorCode` type contains:

| Code                            | Meaning                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ERR_INVALID_MARKERS`           | A profile or caller command contains incomplete, reversed, nested, or conflicting markers.     |
| `ERR_PACKAGE_NOT_FOUND`         | The guarded entry has no ancestor `package.json` with a package name.                          |
| `ERR_SHELL_RESTART_REQUIRED`    | The first installation has not yet been loaded by a restarted shell.                           |
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
