# Agent Terminal

A dedicated terminal in VS Code's secondary sidebar for running CLI coding agents such as [pi](https://github.com/earendil-works/pi), Claude Code, Codex, Gemini CLI or Aider.

This is a fork of [Nolikzero/claude-terminal-panel](https://github.com/Nolikzero/claude-terminal-panel) (MIT). See [Differences from upstream](#differences-from-upstream).

![Agent Terminal Screenshot](media/screenshot.png)

## Differences from upstream

- **Renamed** to _Agent Terminal_ (`patrick-lindemann.agent-terminal`). All command, view and setting IDs moved from `claudeTerminal.*` to `agentTerminal.*`, so it installs side by side with the original. Settings are not migrated: copy `claudeTerminal.*` entries to `agentTerminal.*`.
- **Default command** is `pi` instead of `claude`.
- **Agent profiles** replace `agentTerminal.command` and `agentTerminal.args`: an ordered list with built-in support for pi, Claude Code and Codex and any custom CLI. See [Agent profiles](#agent-profiles).
- **Agent status on tabs** (working, needs input, done, failed), read from what the agents report. See [Agent status](#agent-status).
- **Browser-style tabs** above the terminal, labelled with a short key from the conversation summary or session name, e.g. `refactor-api-client`.
- **Modified keys reach the agent.** The terminal is an xterm.js instance inside a webview, not a VS Code integrated terminal, so `workbench.action.terminal.sendSequence` keybindings do not apply to it. The webview now handles these keys itself:
  | Key | Sent to the program |
  | --- | --- |
  | `Shift+Enter` | `ESC [13;2u` (CSI-u), distinguishable from `Enter` |
  | `Option/Alt+Enter` | `ESC CR` |
  | `Cmd+C` | Copies the terminal selection to the clipboard |
  | `Cmd+V` | Pastes the clipboard (bracketed paste when the program enables it) |
- **Exited processes no longer leave a dead tab.** After `/exit` the tab closes (the last tab is replaced by a fresh one). After an error, the output stays and `Enter` restarts the command, `Esc` closes the tab. See `agentTerminal.onExit`.
- **Releases are built for VS Code's current Electron** (43.8.3, VS Code 1.144) and published as GitHub release assets, not to the Marketplace.

## Installation

Install or update to the latest release with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/patrick-lindemann/agent-terminal/main/install.sh | sh
```

Run it in a VS Code terminal. On a Remote-SSH connection, run it in the remote window's terminal so it installs the Linux build into the remote VS Code server. The script picks the `.vsix` for the current OS and architecture from the [latest release](https://github.com/patrick-lindemann/agent-terminal/releases/latest). Set `CODE=cursor` (or another CLI) to install into a different editor.

Then reload the window, open the **Agent Terminal** view in the secondary sidebar and, if needed, set your agents in [`agentTerminal.profiles`](#agent-profiles).

### Branches and releases

- `develop` is the working branch. All changes are committed there.
- `main` only contains released versions. A release is a pull request from `develop` to `main`.
- Pull requests run the _CI_ workflow (lint, formatting, type check, build and `npm test` if a test script exists).
- Every push to `main` runs _Build and Release_: it reads the version from `package.json`, builds one `.vsix` per platform and publishes them as release `v<version>`. If that release already exists, the build is skipped.

To release:

1. On `develop`, bump the version without tagging and add a `CHANGELOG.md` entry:
   ```bash
   npm version minor --no-git-tag-version
   ```
2. Open a pull request from `develop` to `main` and merge it with a merge commit (not squash or rebase), so `develop` and `main` keep the same history.

If the terminal stops starting after a VS Code update, update `ELECTRON_VERSION` in `.github/workflows/release.yml` and the `rebuild` script in `package.json` to the Electron version shown in _Help > About_, then release again.

## Requirements

- **VS Code** 1.106.0 or higher
- **An AI CLI tool** installed and accessible in your PATH (see [Supported Tools](#supported-tools))
- **Node.js** - Required for native module compilation

## Supported Tools

This extension works with any command-line AI assistant. Here are some popular options with installation instructions and additional top CLI AI coding agents, including OpenCode:

| Tool                                                                    | Command       | Installation                               |
| ----------------------------------------------------------------------- | ------------- | ------------------------------------------ |
| [Claude Code](https://github.com/anthropics/claude-code)                | `claude`      | `npm install -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli)               | `gemini`      | `npm install -g @google/gemini-cli`        |
| [Aider](https://aider.chat)                                             | `aider`       | `pip install aider-chat`                   |
| [Codex CLI](https://github.com/openai/codex)                            | `codex`       | `npm install -g @openai/codex`             |
| [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli)       | `gh copilot`  | `gh extension install github/gh-copilot`   |
| [Open Interpreter](https://github.com/openinterpreter/open-interpreter) | `interpreter` | `pip install open-interpreter`             |
| [OpenCode](https://github.com/opencode-ai/opencode)                     | `opencode`    | `brew install opencode-ai/tap/opencode`    |
| Any CLI tool                                                            | Custom        | Configure via settings                     |

## Usage

1. **Open the Sidebar** - Click the terminal icon in the activity bar (secondary sidebar)
2. **Interact with your AI** - Type your prompts and interact with your AI assistant directly in the terminal
3. **Use the view title bar** - `+` opens a tab with the first profile, the `…` button next to it lists all profiles and Custom Command…

### Tabs

- A tab strip sits above the terminal. Each tab is named with a short key from the agent's title, e.g. `refactor-api-client` from Claude Code's conversation summary or a pi session's name (`/name`), otherwise the agent's name (`claude-code`). `agentTerminal.tabTitleWords` sets the maximum number of words (default 4). Words are split per language, also in scripts without spaces such as Japanese or Chinese, and filler words such as `the` or `die` are left out for [about 60 languages](https://github.com/fergiemcdowall/stopword#language-code); other languages keep all their words. Set `agentTerminal.autoTabTitles` to `false` to always show the agent's name.
- The tooltip shows the agent, the full title and the status.
- An icon at the start of a tab shows its [status](#agent-status). In multi-root workspaces, the left border shows the folder's color.
- `×` closes a tab; it shows on the active tab and on hover. Middle-click also closes a tab; right-click opens Close and Close Others. Closing a tab whose agent is working or waiting for input asks first, since it ends the session. Choose **Close and Don't Ask Again** or set `agentTerminal.confirmClose` to `false` to turn this off.
- Tabs share the strip's width. Below their minimum width, scroll the strip sideways with the mouse wheel or trackpad, or use the arrow buttons at its edges.
- `Agent Terminal: Switch Tab…` lists all tabs with their status.

### Commands

| Command                                               | Description                    |
| ----------------------------------------------------- | ------------------------------ |
| `Agent Terminal: New Tab`                             | Create a new terminal tab      |
| `Agent Terminal: Close Tab`                           | Close the current terminal tab |
| `Agent Terminal: Next Tab`                            | Switch to the next tab         |
| `Agent Terminal: Previous Tab`                        | Switch to the previous tab     |
| `Agent Terminal: Switch Tab…`                         | Pick a tab from a list         |
| `Agent Terminal: New Tab: pi`, `Claude Code`, `Codex` | Open a tab with a profile      |

Access commands via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) or the view title bar icons.

### Keyboard Shortcuts

These work while Agent Terminal has focus and follow the browser's tab shortcuts. The terminal program does not receive them; elsewhere in VS Code the keys keep their usual meaning.

| Action         | Windows/Linux     | macOS             |
| -------------- | ----------------- | ----------------- |
| New Tab        | `Ctrl+Shift+T`    | `Cmd+T`           |
| Close Tab      | `Ctrl+Shift+W`    | `Cmd+W`           |
| Next Tab       | `Ctrl+PageDown`   | `Cmd+Alt+Right`   |
| Previous Tab   | `Ctrl+PageUp`     | `Cmd+Alt+Left`    |
| Go to Tab 1–8  | `Alt+1` … `Alt+8` | `Cmd+1` … `Cmd+8` |
| Go to Last Tab | `Alt+9`           | `Cmd+9`           |
| Switch Tab…    | `Ctrl+Tab`        | `Ctrl+Tab`        |

## Configuration

Configure the extension via VS Code Settings (`Cmd+,` / `Ctrl+,`):

| Setting                                 | Type    | Default                | Description                                                             |
| --------------------------------------- | ------- | ---------------------- | ----------------------------------------------------------------------- |
| `agentTerminal.profiles`                | array   | pi, Claude Code, Codex | Profiles for new tabs, in menu order (see below)                        |
| `agentTerminal.autoRun`                 | boolean | `true`                 | Automatically run the command when the terminal opens                   |
| `agentTerminal.shell`                   | string  | `""`                   | Custom shell to use (empty for system default)                          |
| `agentTerminal.env`                     | object  | `{}`                   | Additional environment variables                                        |
| `agentTerminal.directMode`              | boolean | `true`                 | Run command directly without shell wrapper                              |
| `agentTerminal.onExit`                  | string  | `"auto"`               | What happens when the process exits (see below)                         |
| `agentTerminal.programStatus`           | boolean | `true`                 | Show agent status on tabs (see below)                                   |
| `agentTerminal.autoTabTitles`           | boolean | `true`                 | Name tabs with a key from the agent's title, e.g. `refactor-api-client` |
| `agentTerminal.tabTitleWords`           | number  | `4`                    | Maximum number of words in a tab's key                                  |
| `agentTerminal.statusColors`            | boolean | `true`                 | Color the status icons on tabs                                          |
| `agentTerminal.confirmClose`            | boolean | `true`                 | Ask before closing a tab whose agent is working or waiting for input    |
| `agentTerminal.promptNotification`      | boolean | `true`                 | Show notification indicator when terminal awaits input                  |
| `agentTerminal.promptNotificationDelay` | number  | `300`                  | Delay (ms) before showing notification after output stops               |
| `agentTerminal.promptPatterns`          | array   | `[]`                   | Additional regex patterns to detect input prompts                       |

### Agent profiles

`agentTerminal.profiles` lists what new tabs can run, in order. The first profile opens with `+`, when the view starts and when the last tab closes. The `…` button next to `+` lists all profiles, followed by Custom Command…. Leave out agents you have not installed.

```json
{
  "agentTerminal.profiles": [
    { "id": "pi", "command": "/Users/me/bin/pi" },
    { "id": "claude", "args": ["--model", "opus"] },
    { "id": "aider", "label": "Aider", "command": "aider", "args": ["--model", "gpt-4"] }
  ]
}
```

| Field     | Meaning                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `id`      | `pi`, `claude` or `codex` for a built-in agent, any other name for a custom profile |
| `label`   | Name in the menu and on tabs; defaults to the agent's name or the id                |
| `command` | Executable or path; required for custom profiles                                    |
| `args`    | Arguments                                                                           |
| `env`     | Environment variables, added to `agentTerminal.env`                                 |

Built-in agents only need an `id`. They get their [title as tab label](#tabs) and [status](#agent-status) support:

| Agent       | Command  | Added by the extension                                                                                  |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------- |
| pi          | `pi`     | Nothing                                                                                                 |
| Claude Code | `claude` | Nothing                                                                                                 |
| Codex       | `codex`  | `-c` options that make Codex write a notification when a turn completes or needs approval (status only) |

Custom profiles show a terminal icon and the terminal title as label. A custom command (Custom Command…) that runs one of the built-in agents, for example `/opt/homebrew/bin/claude`, is recognized by name. Invalid entries are skipped with a warning; without any valid entry, pi, Claude Code and Codex are used.

### Agent status

An icon at the start of a tab shows what its agent is doing. The icons differ by shape, so they work without color. With `agentTerminal.statusColors` (on by default), the icons also take a theme color.

| Icon                | Meaning                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Sparkle, dimmed     | Idle                                                                                        |
| `⋯`, fading in turn | Working                                                                                     |
| `!` in a triangle   | Needs input: a question, an approval or a login. Stays until you answer.                    |
| `✓`                 | Done while you were looking elsewhere                                                       |
| `✕` in a circle     | Failed while you were looking elsewhere: the agent reported an error or the process crashed |

Done and failed clear once the tab has been in view for a second, or when you type into it. With VS Code's `workbench.reduceMotion`, the working dots stay still. The tooltip and screen readers announce the status with the title, for example "Fix login, Needs input: approve Bash".

The badge on the sidebar icon counts tabs that need you. The status comes from:

- The [Program Status Protocol (OSC 7501)](https://www.superlogical.com/rex/docs/build/program-status), which pi, Claude Code (2.1.295+) and Codex report. The extension answers the support query that pi and Claude Code send before reporting.
- The terminal bell while an agent works, for dialogs that ask something without reporting it, such as pi's `ask_user_question` tool. The tab shows "Needs input" until you type.
- For Codex, the notifications enabled by its profile, which tell a finished turn from a cancelled one.
- For other programs, the [prompt patterns](#prompt-notifications) below.

Set `agentTerminal.programStatus` to `false` to turn this off.

### When the process exits

`agentTerminal.onExit` controls what happens when the command ends, for example after `/exit` in pi:

| Value            | Behavior                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `auto` (default) | Exit code 0 closes the tab. Any other code keeps the output and waits for `Enter` (restart) or `Esc` (close). |
| `close`          | Always close the tab.                                                                                         |
| `restart`        | Restart the command in the same tab. If it exits within 3 seconds of starting, waits like `keep` instead.     |
| `keep`           | Keep the output and wait for `Enter` (restart) or `Esc` (close).                                              |

Closing the last tab opens a new one, so `/exit` in the only tab starts a fresh session.

### Configuration Examples

**Running with shell features:**

```json
{
  "agentTerminal.directMode": false,
  "agentTerminal.shell": "/bin/zsh"
}
```

**Adding environment variables:**

```json
{
  "agentTerminal.env": {
    "ANTHROPIC_API_KEY": "your-api-key",
    "OPENAI_API_KEY": "your-openai-key"
  }
}
```

## Prompt Notifications

For programs that do not report their status, the extension detects when the terminal is waiting for user input and marks inactive tabs as needing input. This helps you notice when your AI assistant needs attention, even when you're working in another part of VS Code.

### Built-in Detection Patterns

The extension automatically detects common prompt patterns:

- **Yes/No prompts**: `[Y/n]`, `(y/n)`, `[yes/no]`
- **Confirmation prompts**: `Confirm?`, `Continue?`, `Accept?`, `Proceed?`, `Apply?`
- **Interactive menus**: `❯`, `›`, numbered selections
- **REPL prompts**: `>`, `>>>`, `command>`
- **Claude Code hints**: Plan file prompts, "Would you like to" questions
- **General prompts**: "Press enter to confirm", "Esc to cancel"

### Custom Prompt Patterns

If your AI tool uses custom prompts not detected by default, you can add your own regex patterns:

```json
{
  "agentTerminal.promptPatterns": ["^mybot> $", "\\[waiting\\]", "^Input: $"]
}
```

### Disabling Notifications

To disable prompt notifications entirely:

```json
{
  "agentTerminal.promptNotification": false
}
```

## Custom Commands

Click the CLI icon button (next to the + button) in the tab bar to create a terminal with a custom command instead of the default.

### Command Input

When creating a custom terminal, you'll be prompted to enter:

1. **Command**: The CLI tool to run (e.g., `aider`, `gemini`, `opencode`)
2. **Arguments**: Additional flags and options

### Intelligent Flag Suggestions

As you type, the extension fetches available flags from the command's `--help` output and suggests them. This works with most CLI tools including:

- Claude Code
- Gemini CLI
- Aider
- OpenCode
- And any tool that supports `--help`

### Working Directory Selection

In multi-root workspaces, you'll be prompted to select which folder the terminal should start in. Each folder gets a unique accent color on its tab for easy identification.

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch
```

### Running in Debug Mode

1. Open this project in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension will be active in the new VS Code window

### Available Scripts

| Script             | Description                |
| ------------------ | -------------------------- |
| `npm run compile`  | Compile the extension      |
| `npm run watch`    | Watch mode for development |
| `npm run lint`     | Run ESLint                 |
| `npm run lint:fix` | Fix ESLint issues          |
| `npm run format`   | Format code with Prettier  |
| `npm run package`  | Create VSIX package        |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

For bugs and feature requests, please [open an issue](../../issues).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [xterm.js](https://xtermjs.org/) - The terminal emulator powering the UI
- [node-pty](https://github.com/microsoft/node-pty) - Native pseudoterminal support
- [Codicons](https://github.com/microsoft/vscode-codicons) (CC BY 4.0) - Status icons on tabs
- [stopword](https://github.com/fergiemcdowall/stopword) - Filler words for tab names

Full licenses and notices are in [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

---

<p align="center">
  Made with care for the AI-assisted development community
</p>
