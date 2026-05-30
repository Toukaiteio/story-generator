# Release and Auto Update Workflow

This project publishes packaged Windows builds to GitHub Releases. Packaged apps check the GitHub release feed for updates through `electron-updater`.

## CI

The CI workflow runs on pushes to `main` / `master` and on pull requests:

1. Install dependencies with `npm install`.
2. Run `npm run typecheck`.
3. Run `npm run build`.

## Release

The release workflow runs when a version tag is pushed:

```bash
npm version patch
git push origin main --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate. The tag must start with `v`, for example `v0.1.1`.

The workflow builds a Windows NSIS installer and publishes it to:

```text
https://github.com/Toukaiteio/story-generator/releases
```

The release includes `latest.yml`, `.exe`, and `.blockmap` files. `latest.yml` is required by `electron-updater`.

## Auto Updates

Auto update checks run only in packaged builds. The app checks shortly after launch and then every six hours. Users can also check manually from Settings -> Software Updates.

When an update is downloaded, the app prompts the user to restart and install it. If unsaved changes are present, the prompt advises saving first and leaves the update available for later installation.

