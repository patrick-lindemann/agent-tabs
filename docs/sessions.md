# Sessions and multiplexers

By default, Agent Tabs restores the tab order, active tab, pane layout and pane sizes for the workspace. Claude Code, pi and Cursor resume their conversation after you send a message. Other agents start their profile again in its working folder. Turn off restoration with `agentTabs.restoreTabs`.

**Reopen Closed Tab** (`Cmd+Shift+T` on macOS, `Ctrl+Shift+T` on Windows and Linux) remembers the last ten closed tabs per workspace that received a message. Claude Code, pi and Cursor resume their conversation when reopened.

## Keep agents running after you close VS Code

Set `agentTabs.multiplexer` on the machine that runs the agents. For a remote workspace, use the remote settings. A profile can override the setting, as the shell profile does here:

```json
"agentTabs.multiplexer": "tmux",
"agentTabs.profiles": [
  { "name": "Claude Code", "command": "claude" },
  { "name": "Shell", "command": "bash", "multiplexer": "none" }
]
```

- **tmux** (3.2 or later) runs Agent Tabs sessions on a separate server, `tmux -L agent-tabs`. Your `~/.tmux.conf` still applies. Agent Tabs reads status through a control client. Use the mouse wheel to scroll through tmux history. `prefix d` detaches the tab and Enter attaches it again.
- **abduco** passes output and status through directly. Agent Tabs keeps the scrollback. Full-screen agents redraw when the tab attaches again.

Closing a tab ends its session. Closing or reloading the window, or losing the connection, keeps it running. Open the same workspace again to attach, including from another computer when using a remote. If the status changed while you were away, the tab shows it after the agent reports again.

Agent Tabs only lists, attaches to, or ends sessions it tagged on the machine running the agents. When a window opens, it cleans up sessions from other workspaces whose agents have already exited. Running agents stay up until you open their workspace and close their tabs.
