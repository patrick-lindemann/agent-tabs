# Agents in Docker

An image with every agent Agent Tabs recognizes (except Antigravity, Grok,
Hermes and Devin, which have no Linux package to install here), plus tmux and
abduco, for checking what the extension assumes about them:

```bash
npm run test:agents
```

This builds the image and runs `probe.sh` in it. It needs no logins: it reads
versions, subcommands and how the agents treat conversation IDs. To try
an agent by hand, e.g. after logging in:

```bash
docker run --rm -it agent-tabs-agents bash
```

Logins stay in the container and are gone when it exits. Never bake
credentials into the image.
