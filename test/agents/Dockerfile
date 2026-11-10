# The coding agents Agent Tabs recognizes, for checking how they behave,
# e.g. which subcommands they have or what they print for a new
# conversation ID. Most need a login before they start a conversation;
# see test/agents/README.md.
FROM node:22-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux curl ca-certificates git build-essential \
  && rm -rf /var/lib/apt/lists/*
# abduco is not packaged for Debian 12
RUN git clone --depth 1 https://github.com/martanne/abduco /tmp/abduco \
  && make -C /tmp/abduco install \
  && rm -rf /tmp/abduco
RUN npm install -g \
    @anthropic-ai/claude-code \
    @openai/codex \
    @google/gemini-cli \
    opencode-ai \
    @earendil-works/pi-coding-agent \
    @github/copilot \
  && npm cache clean --force
USER node
WORKDIR /home/node/work
# Cursor's CLI installs into ~/.local/bin
RUN curl -fsSL https://cursor.com/install | bash
ENV PATH="/home/node/.local/bin:${PATH}"
