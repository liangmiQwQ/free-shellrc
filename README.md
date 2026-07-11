# free-shellrc

Safely install product-owned shell integration in the current user's Bash, Zsh, Fish, Windows PowerShell, and PowerShell 7 profiles.

`free-shellrc` owns only a clearly marked block. It preserves the rest of the profile, including its encoding, line endings, permissions, and symbolic link. Calling it repeatedly with the same commands does not rewrite the profile.

## Install

```sh
vp install free-shellrc
```

## Use

Pass the shell-specific commands to install and the name of your executable:

```ts
import { installShellrc } from 'free-shellrc'

const changed = await installShellrc(
  {
    bash: 'eval "$(acme shell-init bash)"',
    zsh: 'eval "$(acme shell-init zsh)"',
    fish: 'acme shell-init fish | source',
    pwsh: 'acme shell-init pwsh | Invoke-Expression'
  },
  'acme'
)

if (changed) {
  console.log('Restart your shell or reload its profile to use the integration.')
}
```

Only include shells your application supports. The promise resolves to `true` if at least one profile changed and `false` if every requested profile already contained the same managed block.

The supported shell identifiers are:

```ts
type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh'
```

`powershell` selects Windows PowerShell 5.1 and is available only on Windows. `pwsh` selects PowerShell 7 or newer. PowerShell profile paths are queried from the requested executable so redirected Documents folders and host-specific paths are respected.

## What to pay attention to

- Ask for the user's consent before editing a profile when your product requires it. This library performs the requested installation without prompting.
- Choose the target shells explicitly. The library does not detect the parent or currently active shell.
- Use the real executable name as `productName`. It must match `[A-Za-z0-9._-]+` and must be discoverable on `PATH` when the profile loads.
- Supply valid code for each shell. Commands are inserted as provided, with only their line endings adapted to the profile; they are not translated or validated as shell syntax.
- Do not include the generated marker lines in a command. Marker conflicts stop the installation without writing the profile.
- Tell users to restart their shell or reload the profile after a changed installation. `free-shellrc` cannot modify the state of an already-running parent shell.
- Keep Node.js available on `PATH`. If the product executable later disappears, the generated guard uses Node.js to remove the stale block while preserving the profile bytes. Cleanup failures are ignored so they cannot prevent the rest of the profile from loading.
- Handle unavailable requested shells. In particular, requesting `pwsh` requires the `pwsh` executable, and requesting `powershell` requires Windows PowerShell on Windows.
- PowerShell execution policy is outside this library's scope. A successfully updated profile may still be blocked by the user's policy.
- WSL is a separate Linux environment. Git Bash can use the `bash` adapter when it loads `~/.bashrc`.

## Errors

Expected conflicts are normal `Error` objects with a stable `code` property. The exported `ShellrcErrorCode` type contains:

| Code                            | Meaning                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ERR_INVALID_PRODUCT_NAME`      | `productName` does not match the required pattern.                                             |
| `ERR_INVALID_MARKERS`           | A profile or caller command contains incomplete, reversed, nested, or conflicting markers.     |
| `ERR_UNSUPPORTED_ENCODING`      | An existing profile is not supported UTF-8, UTF-16 LE, or UTF-16 BE.                           |
| `ERR_UNAVAILABLE_SHELL`         | The requested shell executable or profile path is unavailable.                                 |
| `ERR_CONCURRENT_PROFILE_CHANGE` | The profile changed between reading and replacement, so the newer content was not overwritten. |

Filesystem and permission failures retain their original error and cause where applicable.

```ts
import type { ShellrcErrorCode } from 'free-shellrc'

try {
  await installShellrc({ bash: 'acme shell-init bash' }, 'acme')
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
