# Headless runner for the integration tests: VS Code runs on a virtual
# display (Xvfb), so no window opens on the host.
FROM node:22-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb xauth libasound2 libatk-bridge2.0-0 libatk1.0-0 libdrm2 libgbm1 libgtk-3-0 \
    libnss3 libsecret-1-0 libxkbfile1 libxss1 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /work
