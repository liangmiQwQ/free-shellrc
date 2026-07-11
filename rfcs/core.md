# RFC: Core

`free-shellrc` manages product-owned blocks in user shell profile files without owning the rest of the file.

The library targets CLI authors who need to install shell functions, aliases, completions, or initialization commands on Windows, macOS, and Linux. Callers generate the shell code. `free-shellrc` resolves the profile and manages the lifecycle of that code.

## Goals

- Support Bash, Zsh, Fish, Windows PowerShell 5.1, and PowerShell 7 or newer.
- Install and update one product-owned block in each requested shell profile.
- Remove stale managed blocks automatically after the product is uninstalled.
- Preserve user-owned content, file encoding, line endings, permissions, and symbolic links.
- Make repeated operations idempotent.
- Report whether an installation changed any profile.

## Non-goals

- Generating application-specific functions, aliases, completions, or command wrappers.
- Allowing a child process to change its parent shell state.
- Managing PowerShell execution policy.
- Editing `cmd.exe` AutoRun registry entries.
- Managing system-wide or all-user profiles.

Git Bash can use the Bash adapter when its startup file is `~/.bashrc`. WSL is treated as a separate Linux environment.

## Supported shells

The public shell identifiers are:

```ts
export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh'
```

`powershell` means Windows PowerShell 5.1 and is only available on Windows. `pwsh` means PowerShell 7 or newer and can be available on every supported operating system.

Bash and Zsh share a shell language in many cases, but they remain separate identifiers because their profile resolution rules differ. Windows PowerShell and PowerShell 7 share a language but remain separate because they use different executables and profile locations.

## Public API

The public API contains a guard and an installation function:

```ts
export type ShellrcError = Error & { code: ShellrcErrorCode }

export function shellrcGuard(entry: string | URL): ShellrcError | undefined

export function installShellrc(
  commands: (shellType: Shell) => string,
  shell?: Shell[]
): Promise<boolean>
```

The downstream application must call `shellrcGuard(import.meta.url)` at the top of its complete entry, before other application logic. The guard locates the nearest named `package.json` and returns an error when the current shell is unsupported or a first-install restart marker exists.

`commands` produces the caller-provided command for a selected shell. The command remains shell-specific and is not translated between shell languages.

When `shell` is omitted, installation targets the current shell detected by `shellrcGuard`. When it is provided, installation targets each listed shell in order. The library resolves the corresponding current-user profiles and invokes `commands` once for each selected shell.

The package name discovered by `shellrcGuard` identifies the owning product and is used in the managed block's comment markers. The guarded JavaScript entry and discovered package manifest identify whether the package remains installed. Callers cannot supply a separate product identity.

The promise resolves to `true` when at least one profile changes and `false` when every profile already contains the requested block. Installing the same commands twice therefore returns `false` and does not write any file.

`shellrcGuard` returns a `ShellrcError` when an expected guard condition should stop the application and `undefined` when it may continue, so callers do not need a `try`/`catch` around startup control flow. Unexpected input, package manifest, and filesystem failures still throw. Installation failures reject the promise. Expected conflicts use stable error codes so callers can distinguish invalid markers, unsupported encodings, unavailable shells, and concurrent changes. The implementation should use normal `Error` objects with typed properties rather than an exported error class hierarchy.

## Profile resolution

Profile resolution targets the current user.

| Shell        | Default resolution                                        |
| ------------ | --------------------------------------------------------- |
| Bash         | `$HOME/.bashrc`                                           |
| Zsh          | `${ZDOTDIR:-$HOME}/.zshrc`                                |
| Fish         | `${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish`      |
| PowerShell   | Query `powershell.exe` for `$PROFILE.CurrentUserAllHosts` |
| PowerShell 7 | Query `pwsh` for `$PROFILE.CurrentUserAllHosts`           |

The PowerShell paths must be queried from the selected executable instead of being constructed from a presumed Documents directory. Windows can redirect Documents through system policy or OneDrive, and PowerShell hosts do not all use the same profile filename.

The PowerShell query runs without loading profiles. Failure to find or run the requested executable is reported as an unavailable-shell error.

The Bash default intentionally targets interactive non-login shells. Login-shell-only and other non-standard profile layouts are outside the initial API.

`ZDOTDIR` can be set inside shell startup files without being exported to child processes. A custom Zsh setup whose `ZDOTDIR` is not visible in the process environment is outside the initial API.

## Managed blocks

Every downstream package has a stable package name. The library uses comments to mark the complete area it owns:

```text
# >>> _<packageName>_START >>>
# <<< _<packageName>_END <<<
```

Markers occupy complete lines and are matched exactly. They are derived from the downstream package name; callers cannot override them.

An installed block contains the opening marker, a warning not to edit the managed region, a shell-specific package-installation guard, the caller-provided command for that shell, a shell-specific self-removal routine, and the closing marker. The caller's command remains opaque and is inserted exactly as provided apart from converting its line endings to match the target file.

The first time a product block is added, installation creates a package-specific file in the operating system's temporary directory. A supported shell removes that file when it loads the new block and confirms the product is available. Until then, `shellrcGuard` reports `ERR_SHELL_RESTART_REQUIRED`. This makes the required restart enforceable instead of relying only on caller messaging. Updating or repairing an existing block does not recreate the restart marker.

When a shell loads the block, it first checks that both the JavaScript entry passed to `shellrcGuard` and the discovered package manifest still exist as files. If both exist, the block executes only the caller-provided command. If either is missing, the package is considered uninstalled: the block does not execute the command and instead removes its own complete managed region from that profile. This cleanup must target the resolved profile containing the block, match the exact marker lines, preserve all content outside the region, and leave the profile file in place even when it becomes empty.

The availability guard and cleanup routine are library-generated implementation details for Bash, Zsh, Fish, Windows PowerShell, and PowerShell 7. They must not rewrite or reinterpret the caller-provided command. A cleanup failure must not prevent the rest of the user's profile from loading.

The cleanup program is maintained as a standalone JavaScript source file and imported as raw text during the library build. Installation writes a copy outside the package to an opaque package-specific directory in the operating system's persistent per-user state directory. The directory name does not expose either the downstream package name or `free-shellrc`, and each shell profile receives its own helper identified by the shell and profile path. The managed block invokes that copy so cleanup continues after the package is removed without embedding the program in the profile.

After a helper successfully removes its managed block, it removes itself and then removes its directory when no other profile helpers remain. A missing helper must not prevent the rest of the profile from loading. Installing or updating a block recreates its helper when needed, including when the profile block itself is unchanged.

Installation follows these rules:

1. If no block exists, append it to the file with an owned separator.
2. If one complete block exists, replace it in place.
3. If multiple complete blocks exist, keep the first position and remove the duplicates.
4. If markers are incomplete, reversed, or nested, stop without writing and report an invalid-marker error.

The separator inserted while appending belongs to the managed region. Self-removal removes that separator together with the block, so installing and later cleaning up restores the original bytes.

The implementation must not use a regular expression that can consume unrelated content across malformed or mismatched markers. It should scan exact marker lines and validate their order before producing updated content.

## Content preservation

Content outside the managed region is user-owned and must remain byte-for-byte identical.

Updating a block must not:

- Move it to the end of the file.
- Trim trailing whitespace from user content.
- Normalize unrelated line endings.
- Add or remove a final newline outside the managed region.
- Replace a symbolic link with a regular file.
- Change existing permissions as a side effect.

The library writes only when the encoded result differs from the original bytes.

## Encoding

The file layer reads bytes before decoding. It supports:

- UTF-8 without a byte-order mark.
- UTF-8 with a byte-order mark.
- UTF-16 little-endian with a byte-order mark.
- UTF-16 big-endian with a byte-order mark.

Existing files retain their encoding and byte-order mark. A file without a byte-order mark must be valid UTF-8; otherwise the library stops without writing and reports an unsupported-encoding error. Silently replacing undecodable bytes is not allowed.

New Bash, Zsh, Fish, and PowerShell 7 profiles use UTF-8 without a byte-order mark. New Windows PowerShell 5.1 profiles use UTF-8 with a byte-order mark so non-ASCII integration content is not interpreted through the legacy Windows code page.

Existing line endings are preserved. New files use the platform line ending.

## File updates

The library creates a missing parent directory and profile file for the current user when installing a product block.

Before replacing content, the implementation verifies that the bytes read for transformation still match the target. A concurrent change aborts the operation instead of overwriting the newer content.

Updates should use a temporary sibling file and replace the resolved target only after the new bytes are complete. When the profile path is a symbolic link, the library updates its resolved target and leaves the link itself intact. Existing file permissions are applied to the replacement.

Filesystem and permission failures propagate with their original error as the cause. The library does not retry permission errors or attempt privileged writes.

Self-removal does not delete the profile file, even when removal leaves it empty. The file can contain user-owned metadata or be intentionally present for shell startup behavior.

## Caller responsibilities

Callers are responsible for:

- Choosing additional shells to configure when installation should extend beyond the current shell.
- Generating syntactically valid content for each shell.
- Asking for user consent before modifying a profile when their product requires it.
- Telling users when a shell restart or profile reload is needed.
- Diagnosing PowerShell execution policy when a profile is not loaded.

`free-shellrc` does not execute the installed command during installation. The user's shell executes it when loading the managed block and the product is still available.

The application must place `shellrcGuard(import.meta.url)` before other entry logic and stop when it returns an error so an unsupported shell or pending restart stops the complete application consistently.

## Verification

Pure transformation tests cover:

- Adding, replacing, repairing duplicates, self-removing, and repeated operations.
- Files with and without final newlines.
- LF and CRLF input.
- Product-derived and malformed markers.
- Preservation of all bytes outside the managed region.
- Every supported encoding and byte-order mark.
- Package-present, entry-missing, and manifest-missing branches of each shell-specific managed block.
- Unsupported current shells and the create, reject, and shell-load removal lifecycle of the first-install restart marker.

Filesystem tests use temporary directories and cover missing parents, unchanged writes, permissions, symbolic links, and concurrent-change detection. Tests must never target a developer's actual shell profile.

CI runs on Windows, macOS, and Linux. Shell-specific integration tests query real installed shells where the runner provides them, including Windows PowerShell and PowerShell 7 on Windows.

## Adoption

The library can ship before either consumer migrates.

Existing applications adopt it by calling `shellrcGuard(import.meta.url)` at the top of their entry and passing a shell-aware command factory to `installShellrc`. Application-specific wrapper and action protocols stay in their existing repositories.
