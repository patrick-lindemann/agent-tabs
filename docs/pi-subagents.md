# pi-subagents status

[pi-subagents](https://github.com/nicobailon/pi-subagents) can leave background runs active after pi finishes its turn. Starting with pi-subagents 0.77, each run reports its own status through the [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status) (`id=subagents/<run>`, `app=pi-subagents`). Agent Tabs combines the status of those runs with pi’s own:

| pi | A background run | Tab |
| --- | --- | --- |
| Working or done | Working | Working |
| Any | Waiting for an answer | Needs input |
| Done | None left working | Done |

A run counts until pi-subagents reports that it finished, failed, stopped or was cleared. Agent Tabs asks before closing a tab with background runs. Status works with tmux without extra setup.

Set `programStatus: false` in pi-subagents or `PI_PROGRAM_STATUS=0` to turn off its reports. Agent Tabs will then show only pi’s status. It ignores child records from other agents, so a long-running Claude Code shell does not keep that tab marked as working.
