# Contributing

Thanks for helping improve Agent Tabs. Changes are developed on `develop`; `main` contains released versions.

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

## Icons and screenshots

The Marketplace does not accept SVG files in a package, so every SVG in `media/` has a PNG next to it. After changing an SVG, run `npm run icons` and commit the PNG files.

The README screenshots are taken in Docker with a clean VS Code, the packaged extension and demo agents (`scripts/screenshots/agents/demo.js`) that report their status like the real ones, in the example workspace `scripts/screenshots/api-server`:

```bash
npm run screenshots   # writes media/screenshots/*.png
```

Biome is used for linting and formatting; use `npm run lint:fix` or `npm run format` to apply fixes. Markdown is not formatted by Biome.

## Pull requests

Keep changes focused, add or update tests where appropriate, and ensure the checks above pass. Open pull requests against `develop`.

## Continuous integration

The **CI** workflow (lint, format, typecheck, build, unit and integration tests) runs on every push to `develop` and on every pull request.

The **Build and Release** workflow runs CI again, then builds the package for every platform. It runs in three ways:

- A push to `main`, i.e. a merged release pull request, releases and publishes.
- A pull request to `main` is a dry run: it builds every platform package and uploads them as artifacts, without releasing or publishing.
- **Actions → Build and Release → Run workflow** does the same dry run for any branch, e.g. to try a workflow change before opening a pull request.

Lint the workflow files after changing them:

```bash
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:latest
```

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
