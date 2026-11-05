# Agent Terminal

A dedicated terminal in VS Code's secondary sidebar for running CLI coding agents such as [pi](https://github.com/earendil-works/pi), Claude Code, Codex, Gemini CLI or Aider.

This is a fork of [Nolikzero/claude-terminal-panel](https://github.com/Nolikzero/claude-terminal-panel) (MIT). See [Differences from upstream](#differences-from-upstream).

![Agent Terminal Screenshot](media/screenshot.png)

## Differences from upstream

- **Renamed** to _Agent Terminal_ (`patrick-lindemann.agent-terminal`). All command, view and setting IDs moved from `claudeTerminal.*` to `agentTerminal.*`, so it installs side by side with the original. Settings are not migrated: copy `claudeTerminal.*` entries to `agentTerminal.*`.
- **Default command** is `pi` instead of `claude`. New tabs are named `Terminal N`.
- **Modified keys reach the agent.** The terminal is an xterm.js instance inside a webview, not a VS Code integrated terminal, so `workbench.action.terminal.sendSequence` keybindings do not apply to it. The webview now handles these keys itself:
  | Key | Sent to the program |
  | --- | --- |
  | `Shift+Enter` | `ESC [13;2u` (CSI-u), distinguishable from `Enter` |
  | `Option/Alt+Enter` | `ESC CR` |
  | `Cmd+C` | Copies the terminal selection to the clipboard |
  | `Cmd+V` | Pastes the clipboard (bracketed paste when the program enables it) |
- **Releases are built for VS Code's current Electron** (43.8.3, VS Code 1.144) and published as GitHub release assets, not to the Marketplace.

## Installation

Download the `.vsix` for your platform from the [latest release](https://github.com/patrick-lindemann/agent-terminal/releases/latest) and install it:

```bash
gh release download --repo patrick-lindemann/agent-terminal --pattern '*darwin-arm64.vsix' --dir /tmp/agent-terminal --clobber
code --install-extension /tmp/agent-terminal/agent-terminal-darwin-arm64-*.vsix
```

Then reload the window, open the **Agent Terminal** view in the secondary sidebar and, if needed, set `agentTerminal.command` (for example to the absolute path of `pi`).

### Publishing a release

Push a `v*` tag; the _Build and Release_ workflow builds one `.vsix` per platform and attaches it to a GitHub release:

```bash
npm version minor   # updates package.json and creates the tag
git push --follow-tags
```

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
3. **Use Quick Actions** - Click the restart icon in the view title bar, or use the + button to add new tabs

### Commands

| Command                        | Description                    |
| ------------------------------ | ------------------------------ |
| `Agent Terminal: Restart`      | Restart the terminal session   |
| `Agent Terminal: New Tab`      | Create a new terminal tab      |
| `Agent Terminal: Close Tab`    | Close the current terminal tab |
| `Agent Terminal: Next Tab`     | Switch to the next tab         |
| `Agent Terminal: Previous Tab` | Switch to the previous tab     |

Access commands via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) or the view title bar icons.

### Keyboard Shortcuts

| Action       | Windows/Linux   | macOS           |
| ------------ | --------------- | --------------- |
| New Tab      | `Ctrl+Shift+``  | `Cmd+Shift+``   |
| Close Tab    | `Ctrl+W`        | `Cmd+W`         |
| Next Tab     | `Ctrl+PageDown` | `Cmd+Alt+Right` |
| Previous Tab | `Ctrl+PageUp`   | `Cmd+Alt+Left`  |

## Configuration

Configure the extension via VS Code Settings (`Cmd+,` / `Ctrl+,`):

| Setting                                 | Type    | Default | Description                                               |
| --------------------------------------- | ------- | ------- | --------------------------------------------------------- |
| `agentTerminal.command`                 | string  | `"pi"`  | The command to run in the terminal                        |
| `agentTerminal.args`                    | array   | `[]`    | Arguments to pass to the command                          |
| `agentTerminal.autoRun`                 | boolean | `true`  | Automatically run the command when the terminal opens     |
| `agentTerminal.shell`                   | string  | `""`    | Custom shell to use (empty for system default)            |
| `agentTerminal.env`                     | object  | `{}`    | Additional environment variables                          |
| `agentTerminal.directMode`              | boolean | `true`  | Run command directly without shell wrapper                |
| `agentTerminal.promptNotification`      | boolean | `true`  | Show notification indicator when terminal awaits input    |
| `agentTerminal.promptNotificationDelay` | number  | `300`   | Delay (ms) before showing notification after output stops |
| `agentTerminal.promptPatterns`          | array   | `[]`    | Additional regex patterns to detect input prompts         |

### Configuration Examples

**pi (default):**

```json
{
  "agentTerminal.command": "pi",
  "agentTerminal.args": []
}
```

**Gemini CLI:**

```json
{
  "agentTerminal.command": "gemini",
  "agentTerminal.args": []
}
```

**Aider:**

```json
{
  "agentTerminal.command": "aider",
  "agentTerminal.args": ["--model", "gpt-4"]
}
```

**OpenAI Codex:**

```json
{
  "agentTerminal.command": "codex",
  "agentTerminal.args": []
}
```

**GitHub Copilot CLI:**

```json
{
  "agentTerminal.command": "gh",
  "agentTerminal.args": ["copilot"]
}
```

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

The extension can detect when the terminal is waiting for user input and show a visual notification (pulsing red dot) on the tab. This helps you notice when your AI assistant needs attention, even when you're working in another part of VS Code.

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

---

<p align="center">
  Made with care for the AI-assisted development community
</p>
