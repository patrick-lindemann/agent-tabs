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
  Marketplace policy names the workflow file `release.yml` and the `production`
  environment, so keep both names.
- To show a change in a development window, run `npm run compile`, then open
  VS Code with its own user data and extensions folders, so the window shares
  no settings, theme, state or extensions with the user's other VS Code
  windows, and no folder:

  ```sh
  dev=/tmp/agent-tabs-dev
  mkdir -p "$dev/user/User" "$dev/extensions"
  code --user-data-dir "$dev/user" --extensions-dir "$dev/extensions" \
    --extensionDevelopmentPath="$PWD" --new-window
  ```

  Never open one with the default user data: Agent Tabs commands such as
  Discover Profiles would change the user's real settings. After another
  change, compile again and run _Developer: Reload Window_ in that window.
