# Agent Tabs

**Your coding agents, side by side with your code.**

Agent Tabs runs Claude Code, Codex, Gemini CLI, pi and other CLI coding agents in tabs in VS Code's secondary sidebar. Keep the editor in front of you, start a few agents on different tasks, and see at a glance which one is working, which one has a question, and which one is done.

![Agent Tabs with four agents in the secondary sidebar](media/screenshots/overview.png)

## Features

### See what every agent is doing

Each tab shows its agent's status: working, needs input, done or failed. A result that comes in while you're in another tab stays marked until you look at it, and the view's badge counts the tabs waiting for you. Agents report their status themselves through the [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status); for the others, Agent Tabs recognizes their prompts.

![Tabs with the status of each agent and pi asking a question](media/screenshots/tabs.png)

### Tabs that name themselves

Tabs take their name from the agent's session: Claude Code's conversation summary, a pi session name or a Codex thread, shortened to a few words. No more five tabs called `claude`.

### Every agent, one place

Open any agent from the `+ ⌄` menu, with its logo. Agent Tabs finds the agents you have installed and makes a profile for each. Profiles are plain command lines, so `claude --continue`, `env MODEL=fast pi` or `tmux new-session codex` all work, and Custom Command runs anything else with completion for its flags.

![The profile menu with installed agents](media/screenshots/profiles.png)

### Works like VS Code

Tabs use the keys you know from editors, clicking `src/app.ts:42` in an agent's output opens it in the editor, and the terminal takes VS Code's theme and font. Closing a tab whose agent is still working asks first. When an agent exits, Enter starts it again in the same tab.

## Supported agents

| Agent | Command | Status | Tab name from |
| --- | --- | --- | --- |
| Claude Code | `claude` | Reported (2.1.295+) | Conversation summary |
| Codex | `codex` | Reported (0.163+) | Thread name |
| pi | `pi` | Reported (1.1+) | Session name (`/name`) |
| OpenCode | `opencode` | Reported | Session title |
| Grok Build | `grok` | Reported (1.0.52+) | — |
| Devin | `devin` | Reported | — |
| Hermes Agent | `hermes` | Reported | Session title |
| Gemini CLI | `gemini` | From prompts | Current thought |
| GitHub Copilot | `copilot` | From prompts | — |
| Cursor | `agent` | From prompts | — |
| Antigravity | `agy` | From prompts | Your title script |

An agent is recognized anywhere in a profile's command line, also behind a wrapper such as `env`, `npx` or `tmux`. Any other program runs too, with a generic icon and prompt-based status. Claude Code reports no status inside tmux.

## Keyboard shortcuts

Active while Agent Tabs has focus.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New tab | `Cmd+T` | `Ctrl+Shift+T` |
| Close tab | `Cmd+W` | `Ctrl+Shift+W` |
| Next / previous tab | `Cmd+Alt+→` / `Cmd+Alt+←` | `Ctrl+PageDown` / `Ctrl+PageUp` |
| Go to tab 1–8 / last tab | `Cmd+1` … `Cmd+9` | `Alt+1` … `Alt+9` |
| Switch tab… | `Ctrl+Tab` | `Ctrl+Tab` |

Line editing follows VS Code too: `Cmd+←/→` jumps to the start or end of the line, `Cmd+Backspace` and `Option+Backspace` delete to the line start or the previous word, and `Shift+Enter` inserts a new line in agents that support it.

## Settings

**Profiles and tabs**

| Setting | Default | Description |
| --- | --- | --- |
| `agentTabs.profiles` | installed agents | Profiles in menu order, each with a `command` line and optionally a `name` and `env`. `+` opens the first. In a remote window, profiles come from the remote's settings. |
| `agentTabs.onExit` | `auto` | When an agent exits: `auto` closes the tab after a clean exit and keeps it after an error, or `close`, `restart`, `keep`. |
| `agentTabs.confirmClose` | `true` | Ask before closing a tab whose agent is working or waiting for input. |

**Tab names and icons**

| Setting | Default | Description |
| --- | --- | --- |
| `agentTabs.autoTabTitles` | `true` | Name tabs after the agent's session instead of the profile. |
| `agentTabs.tabTitleWords` | `4` | Words in a tab name (1–12); filler words are dropped. |
| `agentTabs.monochromeIcons` | `false` | Agent logos in the text color instead of brand colors. |

**Status**

| Setting | Default | Description |
| --- | --- | --- |
| `agentTabs.programStatus` | `true` | Show the status agents report. |
| `agentTabs.statusColors` | `true` | Color status icons and the names of tabs that need you. |
| `agentTabs.promptNotification` | `true` | Mark background tabs whose program shows a prompt, for agents that report no status. |
| `agentTabs.promptNotificationDelay` | `300` | Milliseconds output must be quiet before a prompt counts. |
| `agentTabs.promptPatterns` | `[]` | More regular expressions that match a prompt. |

**Process**

| Setting | Default | Description |
| --- | --- | --- |
| `agentTabs.directMode` | `true` | Start the command directly. Turn off to run it in a shell, for aliases or shell syntax. |
| `agentTabs.shell` | system shell | Shell to use when `directMode` is off. |
| `agentTabs.autoRun` | `true` | With `directMode` off, run the profile's command when the shell starts. |
| `agentTabs.env` | `{}` | Environment variables for every tab. |

## Installation

Install **Agent Tabs** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=patrick-lindemann.agent-tabs), or run:

```bash
code --install-extension patrick-lindemann.agent-tabs
```

Agent Tabs opens in the secondary sidebar. You need VS Code 1.106 or later and at least one agent on your `PATH`.

For offline or remote machines, download the `.vsix` for your platform from the [latest release](https://github.com/patrick-lindemann/agent-tabs/releases/latest) and use **Extensions: Install from VSIX…**, or run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/patrick-lindemann/agent-tabs/main/install.sh | sh
```

## Troubleshooting

- **An agent shows as not installed:** VS Code does not see it on its `PATH`. Start VS Code from a shell where the command works, or add its folder through `agentTabs.env`.
- **An agent needs shell aliases or functions:** turn off `agentTabs.directMode`.
- **The terminal stays blank after a VS Code update:** update Agent Tabs; its terminal module must match VS Code's version.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/patrick-lindemann/agent-tabs). See [CONTRIBUTING.md](CONTRIBUTING.md) for development and testing.

## Acknowledgements

Agent Tabs started as a fork of [Nolikzero/claude-terminal-panel](https://github.com/Nolikzero/claude-terminal-panel). It uses [xterm.js](https://xtermjs.org/), [node-pty](https://github.com/microsoft/node-pty), [stopword](https://github.com/fergiemcdowall/stopword), VS Code Codicons and Lobe Icons; see [THIRD_PARTY.md](THIRD_PARTY.md).

## License

[MIT](LICENSE.md)
