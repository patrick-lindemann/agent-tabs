# Agent instructions

- Work on `develop`. Never commit or push to `main` directly.
- `main` only holds released versions. A release is a pull request from
  `develop` to `main`, merged with a merge commit. Merging it publishes
  release `v<package.json version>` through the _Build and Release_ workflow.
- Before opening a release pull request, bump the version on `develop` with
  `npm version <level> --no-git-tag-version` and add a `CHANGELOG.md` entry.
- Pull requests run the _CI_ workflow; pull requests to `main` also build every
  platform package. Run `npm run lint`, `npm run format:check`, `npm run typecheck`
  and `npm test` locally before pushing.
- Merging to `main` also publishes platform VSIX files to the VS Code Marketplace
  after the GitHub Release succeeds, through trusted publishing: the
  Marketplace policy names the workflow file `publish.yml` and the `production`
  environment, so keep both names.
