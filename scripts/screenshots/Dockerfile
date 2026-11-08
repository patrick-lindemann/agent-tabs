# Takes the README screenshots on a virtual display, so no window opens on
# the host and no other extension or user setting shows up.
FROM node:22-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb xauth xdotool imagemagick \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libdrm2 libgbm1 libgtk-3-0 \
    libnss3 libsecret-1-0 libxkbfile1 libxss1 \
    fonts-inter fonts-jetbrains-mono fonts-dejavu fonts-noto-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
# Inter for the workbench, like a desktop's system font
RUN printf '%s\n' '<?xml version="1.0"?>' '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
    '<fontconfig><alias><family>sans-serif</family><prefer><family>Inter</family></prefer></alias>' \
    '<alias><family>system-ui</family><prefer><family>Inter</family></prefer></alias></fontconfig>' \
    > /etc/fonts/local.conf && fc-cache -f
WORKDIR /work
