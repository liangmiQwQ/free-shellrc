# RFC: Core

`free-shellrc` manages application-owned blocks in user shell profile files without owning the rest of the file.

The library targets CLI authors who need to install shell functions, aliases, completions, or initialization commands on Windows, macOS, and Linux. Callers generate the shell code. `free-shellrc` resolves the profile and manages the lifecycle of that code.

## Goals

- Support Bash, Zsh, Fish, Windows PowerShell 5.1, and PowerShell 7 or newer.
- Install, update, and remove one application-owned block.
- Preserve user-owned content, file encoding, line endings, permissions, and symbolic links.
- Make repeated operations idempotent.
- Provide explicit profile path overrides for unusual shell configurations.
- Return enough information for callers to explain what changed.

## Non-goals

- Detecting the parent shell automatically.
- Generating application-specific functions, aliases, completions, or command wrappers.
- Allowing a child process to change its parent shell state.
- Managing PowerShell execution policy.
- Editing `cmd.exe` AutoRun registry entries.
- Managing system-wide or all-user profiles.
- Removing an integration automatically when its executable disappears.

Git Bash can use the Bash adapter, with an explicit profile path when its startup file differs from `~/.bashrc`. WSL is treated as a separate Linux environment.

## Supported shells

The public shell identifiers are:

```ts
export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh'
```

`powershell` means Windows PowerShell 5.1 and is only available on Windows. `pwsh` means PowerShell 7 or newer and can be available on every supported operating system.

Bash and Zsh share a shell language in many cases, but they remain separate identifiers because their profile resolution rules differ. Windows PowerShell and PowerShell 7 share a language but remain separate because they use different executables and profile locations.

## Public API

The initial public API contains three functions:

```ts
export function resolveShellrcPath(
  shell: Shell,
  options?: ResolveShellrcOptions
): Promise<string>

export function installShellrc(options: InstallShellrcOptions): Promise<ShellrcResult>

export function uninstallShellrc(options: UninstallShellrcOptions): Promise<ShellrcResult>
```

The install operation receives a shell, a stable integration ID, the generated shell code, and optional path or marker overrides. The uninstall operation receives the same identity information without requiring the generated code.

An explicit path always takes precedence over automatic profile resolution.

```ts
export interface ShellrcResult {
  path: string
  action: 'added' | 'updated' | 'unchanged' | 'removed'
}
```

Installing the same content twice returns `unchanged` and does not write the file. Uninstalling an integration that is not present also returns `unchanged`.

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

The Bash default intentionally targets interactive non-login shells. Applications supporting a login-shell-only setup should expose the library's explicit path override instead of modifying both `.bashrc` and `.bash_profile` automatically.

`ZDOTDIR` can be set inside shell startup files without being exported to child processes. When it is not visible in the process environment, callers with a custom Zsh setup must provide the profile path explicitly.

## Managed blocks

Every integration has a stable ID matching `[A-Za-z0-9._-]+`. The default markers are:

```text
# >>> free-shellrc:<id> >>>
# <<< free-shellrc:<id> <<<
```

Markers occupy complete lines and are matched exactly. Callers can provide an explicit marker pair to adopt an existing integration without migrating its users. This allows applications such as `mo` to keep previously published markers.

An installed block contains the opening marker, caller-provided content, and closing marker. The library converts the block's line endings to match the target file but otherwise treats caller content as opaque shell code.

Installation follows these rules:

1. If no block exists, append it to the file with an owned separator.
2. If one complete block exists, replace it in place.
3. If multiple complete blocks exist, keep the first position, remove the duplicates, and return `updated`.
4. If markers are incomplete, reversed, or nested, stop without writing and report an invalid-marker error.

The separator inserted while appending belongs to the managed region. Uninstall removes that separator together with the block, so installing and then uninstalling restores the original bytes.

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

The library creates a missing parent directory and profile file for the current user when installing an integration.

Before replacing content, the implementation verifies that the bytes read for transformation still match the target. A concurrent change aborts the operation instead of overwriting the newer content.

Updates should use a temporary sibling file and replace the resolved target only after the new bytes are complete. When the configured path is a symbolic link, the library updates its resolved target and leaves the link itself intact. Existing file permissions are applied to the replacement.

Filesystem and permission failures propagate with their original error as the cause. The library does not retry permission errors or attempt privileged writes.

Uninstall does not delete the profile file, even when removal leaves it empty. The file can contain user-owned metadata or be intentionally present for shell startup behavior.

## Caller responsibilities

Callers are responsible for:

- Choosing which shells to configure.
- Generating syntactically valid content for each shell.
- Validating that application commands referenced by the content are available.
- Asking for user consent before modifying a profile when their product requires it.
- Telling users when a shell restart or profile reload is needed.
- Diagnosing PowerShell execution policy when a profile is not loaded.

`free-shellrc` does not execute the installed integration content.

## Verification

Pure transformation tests cover:

- Adding, replacing, repairing duplicates, removing, and repeated operations.
- Files with and without final newlines.
- LF and CRLF input.
- Custom and malformed markers.
- Preservation of all bytes outside the managed region.
- Every supported encoding and byte-order mark.

Filesystem tests use temporary directories and cover missing parents, unchanged writes, permissions, symbolic links, and concurrent-change detection. Tests must never target a developer's actual shell profile.

CI runs on Windows, macOS, and Linux. Shell-specific integration tests query real installed shells where the runner provides them, including Windows PowerShell and PowerShell 7 on Windows.

## Adoption

The library can ship before either consumer migrates.

Existing applications adopt it by keeping their current markers, passing their generated integration content to `installShellrc`, and replacing custom removal logic with `uninstallShellrc`. Application-specific wrapper and action protocols stay in their existing repositories.
