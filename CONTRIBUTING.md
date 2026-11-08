# Contributing

Thanks for helping improve SideMates. Changes are developed on `develop`; `main` contains released versions.

## Development setup

Requirements: Node.js 22 (the CI and release workflows use Node 22), npm, and VS Code.

```bash
npm ci
```

Open the repository in VS Code and press **F5** to launch an Extension Development Host. Use `npm run watch` while developing for extension and webview rebuilds.

## Checks and tests

Run the same checks used by CI:

```bash
npm run lint          # Biome checks JavaScript/TypeScript/JSON/CSS
npm run format:check  # Biome formatting check
npm run typecheck
npm run compile
npm test
```

Integration tests launch a downloaded VS Code. By default they run in Docker on a virtual display, so no window opens and nothing takes focus:

```bash
npm run test:integration
```

This needs Docker. The first run builds a small image and downloads VS Code into a Docker volume. To run them in a visible window on your machine instead, use `npm run test:integration:visible` (on headless Linux, through `xvfb-run -a`). The **Extension Tests** launch configuration debugs them in a visible window.

Biome is used for linting and formatting; use `npm run lint:fix` or `npm run format` to apply fixes. Markdown is not formatted by Biome.

## Pull requests

Keep changes focused, add or update tests where appropriate, and ensure the checks above pass. Open pull requests against `develop`.

## Releases

A release is made by bumping the version on `develop`, updating `CHANGELOG.md`, and opening a pull request from `develop` to `main`. Merge it with a merge commit (not squash or rebase). The Build and Release workflow then:

1. Builds platform VSIX files for Linux x64/arm64, macOS x64/arm64, and Windows x64.
2. Creates GitHub release `v<package.json version>` with those VSIX files.
3. Publishes the platform packages to the VS Code Marketplace when the `marketplace` environment has a `VSCE_PAT` secret with Marketplace Manage scope.

The Electron version used to rebuild native modules is single-sourced in `package.json` under `config.electronVersion`. Update that value when preparing a release for a new VS Code Electron version; the rebuild script reads it automatically.

For example:

```bash
npm version minor --no-git-tag-version
```

Update the changelog before opening the release pull request. Do not publish from feature branches; the workflow publishes after a successful release on `main`.
