#!/bin/sh
# Checks what Agent Tabs assumes about the agents, without logging in:
# versions, subcommands and conversation options. Runs inside the image of
# test/agents/Dockerfile; see test/agents/README.md.
set -u
cd ~/work
uuid() { cat /proc/sys/kernel/random/uuid; }

echo "== versions"
for c in claude codex gemini opencode pi copilot agent; do
  printf '%-9s %s\n' "$c" "$(timeout 20 "$c" --version 2>&1 | head -1)"
done

echo "== subcommands (no conversation arguments go in front of these)"
printf 'claude: '; claude --help 2>&1 | sed -n '/^Commands:/,$p' | grep -E '^  [a-z]' | awk '{print $1}' | tr '\n' ' '; echo
printf 'pi:     '; pi --help 2>&1 | sed -n '/Commands:/,/Options:/p' | grep -oE 'pi [a-z-]+' | sort -u | cut -c4- | tr '\n' ' '; echo
printf 'agent:  '; agent --help 2>&1 | sed -n '/^Commands:/,$p' | grep -E '^  [a-z]' | awk '{print $1}' | tr '\n' ' '; echo

echo "== Claude: --resume of an unknown ID fails, so only started conversations are resumed"
timeout 20 claude --resume "$(uuid)" -p hi 2>&1 | head -1

echo "== Cursor: --new-session-id exists and takes a UUIDv4"
timeout 10 agent --new-session-id nope -p hi 2>&1 | head -1
timeout 10 agent --new-session-id "$(uuid)" --resume x -p hi 2>&1 | head -1

echo "== pi: the notice for a new session ID, which the tab hides"
grep -rhoE "Warning: No project session found with id[^\`]*" \
  "$(npm root -g)/@earendil-works/pi-coding-agent/dist/main.js" | head -1
