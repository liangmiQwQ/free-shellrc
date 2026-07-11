# `free-shellrc` Agent Guide

`free-shellrc` is a cross-platform library for safely managing shell integration in user profile files on Windows, macOS, and Linux.

View the [RFCS](/rfcs) directory for accepted and proposed architecture decisions. Do not implement unaccepted behavior ahead of its RFC.

## Development

This project uses Vite+ and `@liangmi/vp-config` with the `lib` preset. Vite+ handles library bundling, linting, formatting, and testing.

## Rules

Use Vite+ as the project manager. Use `vp install` to install dependencies and `vp install -D` for development dependencies. Use `vp run` for package scripts. Do not use `pnpm` or `npm` directly.

Run `vp check` and `vp test` after making changes.

Keep AGENTS.md synchronized with durable project behavior and constraints. Do not store project status or temporary implementation details in it.

Keep code functional. Never use classes. Prefer small reusable functions with one responsibility.

Treat shell profile files as user-owned data. Preserve content outside the managed region, and use temporary directories in tests instead of modifying real user profiles.

Keep generated profile code readable. Do not encode executable cleanup payloads.

Store cleanup helpers in opaque package-specific directories, keep them profile-specific, and remove them after successful cleanup.

Keep the library focused on shell profile integration. Do not add CLI prompts, application-specific aliases, or unrelated process-management features.

Use existing dependencies and platform APIs where they fit. Do not reinvent established behavior.

Add a `.gitkeep` file when creating a new empty directory.
