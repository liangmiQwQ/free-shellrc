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

- Detecting the parent shell automatically.
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

The initial public API contains one function:

```ts
export function installShellrc<RequestedShell extends Shell>(
  shellCommand: Record<RequestedShell, string>,
  productName: string
): Promise<boolean>
```

`shellCommand` contains the caller-provided command for each requested shell. The library resolves the corresponding current-user profiles and installs each command in the managed block for that shell. Commands are shell-specific and are not translated between shell languages.

`productName` identifies the owning product. It must match `[A-Za-z0-9._-]+` and is used in the managed block's comment markers and in its stale-installation check.

The promise resolves to `true` when at least one profile changes and `false` when every profile already contains the requested block. Installing the same commands twice therefore returns `false` and does not write any file.

Expected conflicts use stable error codes so callers can distinguish invalid markers, unsupported encodings, unavailable shells, and concurrent changes. The implementation should use normal `Error` objects with typed properties rather than an exported error class hierarchy.

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

Every product has a stable name matching `[A-Za-z0-9._-]+`. The library uses comments to mark the complete area it owns:

```text
# >>> _<productName>_START >>>
# <<< _<productName>_END <<<
```

Markers occupy complete lines and are matched exactly. They are derived from `productName`; callers cannot override them.

An installed block contains the opening marker, a shell-specific product-availability guard, the caller-provided command for that shell, a shell-specific self-removal routine, and the closing marker. The caller's command remains opaque and is inserted exactly as provided apart from converting its line endings to match the target file.

When a shell loads the block, it first checks whether `productName` is available as a command. If it is available, the block executes only the caller-provided command. If it is unavailable, the block does not execute the command and instead removes its own complete managed region from that profile. This cleanup must target the resolved profile containing the block, match the exact marker lines, preserve all content outside the region, and leave the profile file in place even when it becomes empty.

The availability guard and cleanup routine are library-generated implementation details for Bash, Zsh, Fish, Windows PowerShell, and PowerShell 7. They must not rewrite or reinterpret the caller-provided command. A cleanup failure must not prevent the rest of the user's profile from loading.

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

- Choosing which shells to configure.
- Generating syntactically valid content for each shell.
- Asking for user consent before modifying a profile when their product requires it.
- Telling users when a shell restart or profile reload is needed.
- Diagnosing PowerShell execution policy when a profile is not loaded.

`free-shellrc` does not execute the installed command during installation. The user's shell executes it when loading the managed block and the product is still available.

## Verification

Pure transformation tests cover:

- Adding, replacing, repairing duplicates, self-removing, and repeated operations.
- Files with and without final newlines.
- LF and CRLF input.
- Product-derived and malformed markers.
- Preservation of all bytes outside the managed region.
- Every supported encoding and byte-order mark.
- Product-present and product-missing branches of each shell-specific managed block.

Filesystem tests use temporary directories and cover missing parents, unchanged writes, permissions, symbolic links, and concurrent-change detection. Tests must never target a developer's actual shell profile.

CI runs on Windows, macOS, and Linux. Shell-specific integration tests query real installed shells where the runner provides them, including Windows PowerShell and PowerShell 7 on Windows.

## Adoption

The library can ship before either consumer migrates.

Existing applications adopt it by mapping each supported shell to its generated command and passing that record with the product name to `installShellrc`. Application-specific wrapper and action protocols stay in their existing repositories.
