# Changelog

All notable changes to the "Agent Terminal" extension (fork of "Claude Terminal Panel") will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-11-05

### Fixed

- Linux x64 build failed to load `pty.node` on systems older than glibc 2.42; it is now built on Debian bullseye (glibc 2.31)

## [1.1.1] - 2026-11-05

### Fixed

- Windows x64 release build restored (built on `windows-2022`)

## [1.1.0] - 2026-11-05

### Added

- `Shift+Enter` sends `ESC [13;2u` and `Option+Enter` sends `ESC CR`, so agents such as pi can distinguish them from `Enter`
- `Cmd+C` copies the terminal selection and `Cmd+V` pastes, which the VS Code webview host otherwise blocks

### Changed

- Renamed the extension to "Agent Terminal" (`patrick-lindemann.agent-terminal`); command, view and setting IDs moved from `claudeTerminal.*` to `agentTerminal.*`
- Default command is `pi`; new tabs are named `Terminal N`
- Native modules are rebuilt for Electron 43.8.3 (VS Code 1.144)
- Releases are published as GitHub release assets only

## [1.0.10] - 2026-01-14

### Added

- Path autocomplete for command flags that accept file/directory paths
- Smart detection of path-accepting flags via value hints (`<path>`, `<file>`, `<directory>`, `<directories...>`)
- Hidden file support when user explicitly types a dot prefix
- Support for `~/` home directory paths with proper tilde notation in suggestions

## [1.0.9] - 2026-01-12

### Added

- Clickable file path links in terminal output
- File paths with line:column format support (e.g., `src/file.ts:10:5`)
- Navigation to specific line and column when clicking file paths
- Respects terminal's working directory for relative path resolution

## [1.0.8] - 2026-01-08

### Changed

- Improved scrollbar styling for xterm terminal with better visibility and consistency
- Updated README documentation with VS Code version details and feature enhancements

## [1.0.7] - 2026-01-08

### Changed

- Updated build scripts with separate extension and media compilation
- Bundled xterm.css locally instead of loading from external CDN
- Updated Content Security Policy for improved security
- Updated dependencies: @types/node, @xterm/addon-fit, @xterm/addon-web-links, @xterm/xterm, esbuild, eslint-config-prettier, globals, lint-staged

## [1.0.6] - 2026-01-08

### Added

- Notification pill for terminal input prompts
- Accent color support for terminal tabs

### Changed

- Improved flag addition in command input picker

## [1.0.5] - 2026-01-08

### Added

- Custom command button for creating new terminal instances
- Working directory selection when creating new terminals

### Removed

- Clear terminal command (removed from command palette)

## [1.0.4] - 2026-01-08

### Added

- Scroll management for terminal viewport
- Auto-scroll behavior with scroll position tracking

## [1.0.3] - 2026-01-07

### Changed

- Updated VS Code engine requirement to version 1.106.0
- Enhanced README with multi-tab support features and keyboard shortcuts

## [1.0.2] - 2026-01-07

### Added

- Multi-tab terminal functionality
- New xterm addons for improved terminal experience
- Support for multiple concurrent terminal instances

### Changed

- Improved tab close button styles
- Enhanced terminal instance activation logic
- Updated supported tools documentation with new AI CLI options

## [1.0.1] - 2026-01-06

### Added

- New extension icon/logo
- Screenshot in README for visual reference

### Changed

- Improved release workflow for multi-architecture support

## [1.0.0] - 2025-01-06

### Added

- Initial release
- Dedicated terminal panel in VS Code activity bar
- Support for Claude Code, Gemini CLI, Aider, OpenAI Codex, and any CLI tool
- Full xterm.js terminal emulation with 256-color support
- VS Code theme integration (automatically syncs with your theme)
- Dual execution modes:
  - Direct mode: Runs command directly for cleaner output
  - Shell mode: Spawns shell with full shell features (pipes, redirects, etc.)
- Auto-run on startup (configurable)
- Quick actions: Restart and Clear terminal
- Configurable settings:
  - Custom command and arguments
  - Custom shell path
  - Additional environment variables
  - Direct mode toggle
