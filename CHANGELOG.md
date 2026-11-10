# Changelog

All notable changes to Agent Tabs will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The tabs of the last window open again when VS Code starts, in their order and with the same tab active, like editor tabs: Claude Code, pi and Cursor continue their conversation once a message was sent, other tabs start their profile again in their folder. Turn it off with `agentTabs.restoreTabs`

### Fixed

- A new pi tab no longer shows pi's warning that no project session has the tab's conversation ID; the ID is new on purpose
- A program that exits right after starting no longer opens again and again with `agentTabs.onExit` set to `auto` or `close`: its tab stays open with the exit code, as with `restart`
- Esc in a detached tab asks before it ends the session, since its agent may still be working
- Reloading the view's webview shows the open tabs instead of opening them all a second time
- A session that is still starting when the view closes keeps running for the next view
- Cancelling the folder choice in a multi-root workspace no longer opens the tab in the first folder
- No extra tab opens when one was opened while the last window's tabs were restored

## [3.1.0] - 2026-11-10

### Added

- `agentTabs.defaultProfile` picks the profile `+` opens by its name, instead of the first one in the list; it can differ per machine, e.g. on a remote

### Changed

- Profiles need a `name` again, unique among them, since `agentTabs.defaultProfile` refers to it: `[{ "name": "Claude Code", "command": "claude" }]`. A profile without one is skipped with a warning

## [3.0.0] - 2026-11-10

### Breaking

- Keybindings follow VS Code's editor tabs: new tab is `Cmd+N` / `Ctrl+N`, go to tab is `Ctrl+1…9` on macOS and the last tab is `Ctrl+0` / `Alt+0`; closing stays `Ctrl+Shift+W` on Windows and Linux, where `Ctrl+W` deletes a word in the agents
- `agentTabs.profiles` is a list again: each profile has a `command` and optionally a `name`, `env` and `multiplexer`, e.g. `[{ "command": "claude --continue" }, { "name": "Pi fast", "command": "pi", "env": { "MODEL": "fast" } }]`. A profile without a name is named after its agent or program. The table of names and command lines from 2.0 is no longer read; write your profiles as a list again

### Added

- Reopen Closed Tab (`Cmd+Shift+T` / `Ctrl+Shift+T`) opens the last closed tab again and continues its conversation, for Claude Code, pi and Cursor; it remembers the last ten closed tabs per workspace once a message was sent in them
- Closing a tab with a message you have not sent asks first, like closing one whose agent is working; only the number of typed characters is tracked, never the text
- `Ctrl+Shift+Tab` lists the tabs from the least recently used, and `Ctrl+Tab` now lists them most recently used first
- `agentTabs.multiplexer` runs tabs in tmux (3.2 or later) or abduco sessions that keep running when the window closes or loses its connection to a remote; the next window of the workspace attaches to them again, also from another computer. Status works inside tmux too. Only sessions Agent Tabs started are touched, and those whose agent exited are cleaned up. Profiles can choose their own with `multiplexer`, or `none`

### Fixed

- In a remote window, profiles from the local settings no longer mix with the remote's: `agentTabs.profiles`, `agentTabs.shell` and `agentTabs.env` are read from the remote's settings (or the workspace's)

## [2.0.1] - 2026-11-08

### Fixed

- Available on the Marketplace for Linux, Windows and Intel Macs; 2.0.0 was only published for Apple Silicon Macs
- Clicking a web link in a terminal opens it in the browser

## [2.0.0] - 2026-11-08

Agent Terminal is now **Agent Tabs**.

### Breaking

- The extension ID is now `patrick-lindemann.agent-tabs` and the repository `patrick-lindemann/agent-tabs`
- Settings are renamed from `agentTerminal.*` to `agentTabs.*` and are not carried over; set your profiles again under `agentTabs.profiles`
- Command IDs are renamed from `agentTerminal.*` to `agentTabs.*`; custom keybindings need the new IDs
- `agentTabs.profiles` only accepts a table of names and command lines; the list format from 1.2 is no longer read

### Added

- Agents recognized in a profile's command line, also behind a wrapper such as tmux: Claude Code, Codex, Antigravity, Gemini CLI, OpenCode, pi, Cursor, GitHub Copilot, Grok Build, Hermes Agent and Devin; they get their logo and status support
- Agent logos in Use Profile… and on tabs, in brand colors or the text color (`agentTabs.monochromeIcons`)
- Manage Profiles opens `agentTabs.profiles` in the Settings editor
- Without any profile, there is one for each known agent that is installed
- A profile whose command or agent is not installed shows an error naming the missing command; Use Profile… marks it as not installed
- Tab names from Codex thread names, OpenCode session titles and Gemini CLI's current thought

### Changed

- `+` and `…` in the view title bar are replaced by a `+ ⌄` split button at the end of the tab strip, like the one in VS Code's terminal panel
- Use Profile… marks the first profile with `(default)`
- Needs input shows `!` and failed `✕`; with `agentTabs.statusColors`, the tab's name also turns yellow, green or red
- Tab names keep the title's case and spaces: `Refactor API client` instead of `refactor-api-client`
- A tab shows its agent's logo while idle and a status icon while there is a status
- Settings are grouped by topic in the Settings editor
- Releases run the tests first and are published to the Marketplace with trusted publishing

### Fixed

- A cancelled turn no longer shows as done
- A bell, notification and status report in the same output are applied in the order the agent wrote them
- pi sessions in folders with hyphens get their name as tab title
- Codex and OpenCode tab names no longer contain status words or the folder name
- With `bash -c "codex"`, the status options are no longer passed to the shell
- A failed exit no longer shows the message of an old question
- Turning off `agentTabs.promptNotification` clears prompts already shown
- Releases include the Windows package again

## [1.2.0] - 2026-11-06

### Added

- `agentTerminal.onExit` setting (`auto`, `close`, `restart`, `keep`)
- `agentTerminal.profiles`: an ordered list of profiles for new tabs, with built-in pi, Claude Code and Codex and custom CLIs; the first one is the default and the `…` button next to `+` lists them all
- Agent status on tabs from OSC 7501 reports, the terminal bell and Codex notifications, shown as an icon readable by shape (working, needs input, done, failed) with optional status colors (`agentTerminal.statusColors`); it clears after a second in view and is announced to screen readers; a badge on the sidebar icon counts tabs that need attention (`agentTerminal.programStatus`)
- Tabs are named with a short key from the agent's terminal title, e.g. `refactor-api-client` from Claude Code's conversation summary or a named pi session (`agentTerminal.autoTabTitles`, `agentTerminal.tabTitleWords`); words are split per language and filler words removed for about 60 languages; the tooltip shows the full title
- Closing a tab whose agent is working or waiting for input asks first, with Don't Ask Again (`agentTerminal.confirmClose`)
- Tabs keep their width and the strip scrolls sideways, with arrow buttons while tabs overflow; a tooltip shows labels that do not fit
- Browser-style tab shortcuts while Agent Terminal has focus: `Cmd+T`, `Cmd+W`, `Cmd+Alt+←/→`, `Cmd+1…9` and `Ctrl+Tab` for Switch Tab… (`Ctrl+Shift+T/W`, `Ctrl+PageUp/PageDown`, `Alt+1…9` on Windows and Linux)
- Tab context menu with Close and Close Others; middle-click closes a tab
- The terminal sends the same sequences as VS Code's terminal for editing keys, e.g. `Cmd+←/→` to the start/end of the line, `Cmd+Backspace` to delete the line and `Option+Backspace` to delete a word

### Changed

- `agentTerminal.command` and `agentTerminal.args` are replaced by `agentTerminal.profiles`
- Tabs moved to a browser-style strip above the terminal; tabs share its width and scroll sideways below their minimum width
- Tab strip uses VS Code's UI font; the `+` and custom-command buttons moved from the tab strip to the view title bar
- The restart button and command are removed; an exited process still restarts with `Enter`
- Close Tab is `Ctrl+Shift+W` on Windows and Linux, so `Ctrl+W` reaches the terminal
- A clean exit (e.g. `/exit`) closes the tab instead of leaving a dead terminal; closing the last tab opens a new one
- After a non-zero exit the output stays and `Enter` restarts the command, `Esc` closes the tab
- Restarting a custom-command tab reuses its command and working directory
- Releases are published on every push to `main` from the version in `package.json`; pull requests run the CI workflow

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
