# Agent instructions

- Work on `develop`. Never commit or push to `main` directly.
- `main` only holds released versions. A release is a pull request from
  `develop` to `main`, merged with a merge commit. Merging it publishes
  release `v<package.json version>` through the _Build and Release_ workflow.
- Before opening a release pull request, bump the version on `develop` with
  `npm version <level> --no-git-tag-version` and add a `CHANGELOG.md` entry.
- Pull requests run the _CI_ workflow. Run `npm run lint`, `npm run format:check`
  and `npm run compile` locally before pushing.
