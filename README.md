<!-- logo -->
# SideMates

**Terminal Agents for VS Code**

SideMates puts CLI coding agents in tabs in VS Code's secondary sidebar, so you can run, monitor, and switch between multiple agent sessions without leaving your workspace.

![SideMates screenshot](media/screenshot.png)

## Features

- Tabs in the secondary sidebar, with live agent status on each tab
- Profiles for Claude Code, Codex, Gemini CLI, OpenCode, pi, Copilot, Cursor, Antigravity, Grok, Hermes, and Devin
- Automatic tab titles from agent session titles
- VS Code-like tab keys and terminal editing shortcuts
- Custom commands, environment variables, prompt notifications, and multi-root workspace support

## Installation

### VS Code Marketplace

Install [SideMates](https://marketplace.visualstudio.com/items?itemName=patrick-lindemann.agent-terminal) from the Marketplace, or run:

```bash
code --install-extension patrick-lindemann.agent-terminal
```

### GitHub release / remote installation

For remote or offline environments, download a platform `.vsix` from the [latest GitHub release](https://github.com/patrick-lindemann/agent-terminal/releases/latest), then install it with **Extensions: Install from VSIX...**. Alternatively, run the installer in a VS Code terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/patrick-lindemann/agent-terminal/main/install.sh | sh
```

Reload VS Code, open the **SideMates** view in the secondary sidebar, and choose a profile.

## Quick start

1. Install a supported CLI agent and make sure its command is on `PATH`.
2. Open the SideMates view in the secondary sidebar.
3. Click **+** to open the first available profile, or **Use Profile…** to choose another.
4. Configure profiles in Settings under `SideMates` when needed.

## Configuration

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for `agentTerminal`.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `agentTerminal.profiles` | object | `{}` | Ordered profile names and command lines for new tabs. |
| `agentTerminal.autoRun` | boolean | `true` | Run the profile command when a tab opens (when shell mode is used). |
| `agentTerminal.shell` | string | `""` | Custom shell path; empty uses the system default. |
| `agentTerminal.env` | object | `{}` | Additional environment variables. |
| `agentTerminal.directMode` | boolean | `true` | Run directly without a shell wrapper. |
| `agentTerminal.onExit` | enum | `"auto"` | Close cleanly exited tabs; keep failed tabs for restart. |
| `agentTerminal.programStatus` | boolean | `true` | Show working, needs input, done, and failed status on tabs. |
| `agentTerminal.autoTabTitles` | boolean | `true` | Use shortened agent titles for tab names. |
| `agentTerminal.tabTitleWords` | integer | `4` | Maximum words in an automatic tab title (1–12). |
| `agentTerminal.statusColors` | boolean | `true` | Color status icons and relevant tab names. |
| `agentTerminal.monochromeIcons` | boolean | `false` | Show agent logos in the text color. |
| `agentTerminal.confirmClose` | boolean | `true` | Confirm closing a working or waiting tab. |
| `agentTerminal.promptNotification` | boolean | `true` | Mark tabs when the terminal is waiting for input. |
| `agentTerminal.promptNotificationDelay` | number | `300` | Delay in milliseconds before a prompt notification. |
| `agentTerminal.promptPatterns` | array | `[]` | Additional regular expressions for input prompts. |

When `agentTerminal.profiles` is empty, SideMates creates profiles for recognized agents installed on the machine. A profile is a name mapped to a command line, for example `{ "Claude": "claude" }`.

## Tab status

Tabs show whether an agent is working, needs input, or finished or failed while you were in another tab. Agents report this through the [Program Status Protocol (OSC 7501)](https://www.superlogical.com/rex/docs/build/program-status). For agents that don't, SideMates guesses from prompt text such as `(y/n)` or `Esc to cancel` in background tabs (`agentTerminal.promptNotification`).

| Agent | Status | Tab title |
| --- | --- | --- |
| Claude Code | Reported (2.1.295+, not inside tmux) | Conversation summary |
| Codex | Reported (0.163+) | Thread name |
| Pi | Reported (1.1+) | Session name (`/name`) |
| OpenCode | Reported | Session title |
| Grok Build | Reported (1.0.52+) | — |
| Devin | Reported | — |
| Hermes Agent | Reported (when released) | Session title |
| Gemini CLI | Guessed from prompts | Current thought, if shown in the title |
| GitHub Copilot | Guessed from prompts | — |
| Cursor | Guessed from prompts | — |
| Antigravity | Guessed from prompts | Your `title.sh` output |

## Keyboard shortcuts

These commands apply when SideMates has focus. On macOS use the **mac** key; Windows/Linux is shown otherwise.

| Command | Windows/Linux | macOS |
| --- | --- | --- |
| New tab | `Ctrl+Shift+T` | `Cmd+T` |
| Close tab | `Ctrl+Shift+W` | `Cmd+W` |
| Next / previous tab | `Ctrl+PageDown` / `Ctrl+PageUp` | `Cmd+Alt+Right` / `Cmd+Alt+Left` |
| Switch tab… | `Ctrl+Tab` | `Ctrl+Tab` |
| Tab 1–9 | `Alt+1` … `Alt+9` | `Cmd+1` … `Cmd+9` |

Common terminal editing keys mirror VS Code: `Cmd/Ctrl+Left/Right` moves to line start/end, `Cmd+Backspace` deletes to the start, `Option/Alt+Backspace` deletes a word, `Shift+Enter` inserts a distinguishable multiline enter, and `Cmd/Ctrl+C` and `Cmd/Ctrl+V` copy and paste.

## Troubleshooting

- **The terminal does not start after a VS Code update:** the native `node-pty` module must match VS Code's Electron version. Install the latest SideMates release.
- **A profile is marked not installed:** install its CLI and ensure it is available on the `PATH` inherited by VS Code, then reload the window.
- **A CLI is not recognized:** check the command in the profile and use `agentTerminal.directMode: false` when it requires shell features.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, testing, and release instructions.

## Acknowledgements

SideMates started as a fork of [Nolikzero/claude-terminal-panel](https://github.com/Nolikzero/claude-terminal-panel) (MIT), with thanks to its author. It uses [xterm.js](https://xtermjs.org/), [node-pty](https://github.com/microsoft/node-pty), [stopword](https://github.com/fergiemcdowall/stopword), VS Code Codicons, and Lobe Icons. See [THIRD_PARTY.md](THIRD_PARTY.md) for bundled logos and library notices.

Older `claudeTerminal.*` settings are not migrated; copy them to the corresponding `agentTerminal.*` settings if needed.

## License

[MIT](LICENSE.md)
