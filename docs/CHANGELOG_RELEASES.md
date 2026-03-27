# Changelog & Releases

This repository includes an automated changelog generator and a simple release workflow to keep releases and the in-app version in sync.

## How it works

- `tools/generate_changelog.js` builds `CHANGELOG.md` from git history and GitHub Release notes.
  In CI the generator opens a Pull Request with the updated `CHANGELOG.md` for review instead of
  committing directly to `master`.
- The CI workflow that runs the generator is `.github/workflows/generate_changelog.yml`.
  It runs on pushes to `master` and when a release is published.
- The wiki publisher (`.github/workflows/publish_wiki.yml`) runs on pushes to `master` and
  publishes `PROJECT_OVERVIEW.md` to the repository wiki.

## Recommended release workflow (simple git flow)

If you prefer the standard git-based release flow (no `gh` CLI required):

**1. Bump the version and create a tag locally:**

```zsh
# bump the patch version (or use minor/major)
npm version patch -m "chore(release): %s"
```

**2. Push the commit and tags to GitHub:**

```zsh
git push origin master
git push --tags
```

**3. Create a GitHub Release from the tag using the GitHub web UI:**

- Go to your repository → Releases → Draft a new release
- Select the tag you just pushed, add release notes, and publish the release

### What happens next

- Publishing a release will trigger the changelog workflow in CI. The generator will create or
  update `CHANGELOG.md` and open a Pull Request for review. Merge that PR to update `master`.
- The wiki publisher workflow runs on pushes to `master` and publishes `PROJECT_OVERVIEW.md` to
  the wiki when the changelog PR (or any other commit) is merged.

## About tokens / authentication

- You do not need to provide secrets for GitHub Actions: Actions injects an automatic
  `GITHUB_TOKEN` into workflow runs, and the workflows use that token to create branches/PRs.
- If you run `tools/generate_changelog.js` locally and want it to push branches or create a PR,
  the script uses your local git credentials. You do not have to set `GITHUB_TOKEN` locally
  unless you specifically want the script to authenticate via token.

## Generate the changelog locally

```zsh
node tools/generate_changelog.js
```

This writes `CHANGELOG.md` but will not create a PR (that requires the CI `GITHUB_TOKEN`).

## Verify the in-app version

After bumping the version, rebuild the site so the new version is embedded in the app:

```zsh
npm run build
```

Open the built site (or run the dev server) and check the Help dialog — the version (and
short git hash when available) appears at the bottom.

## `tools/release.sh` — release helper

A small shell script that wraps `npm version` and git push steps. Supports a safe `--dry-run`
mode and a `--preid` option for prereleases.

### Examples

**Dry-run a minor bump (no changes made):**

```bash
./tools/release.sh minor --dry-run
# -> prints predicted new version (e.g. 0.4.0) and does not edit package.json
```

**Create the version commit and tag locally, do not push:**

```bash
./tools/release.sh minor --no-push
```

**Full release (commit, tag, and push to origin/master):**

```bash
# Run on master with a clean working tree
./tools/release.sh minor
```

**Prerelease — dry-run:**

```bash
./tools/release.sh preminor --preid beta --dry-run
# -> e.g. predicts 0.4.0-beta.0 without changing files
```

**Prerelease — create locally, no push:**

```bash
./tools/release.sh prerelease --preid beta --no-push
# creates tag like v0.3.1-beta.0 locally
```

### Safety notes

- `--dry-run` never edits `package.json` or creates git commits/tags.
- `--no-push` creates the commit and tag locally for inspection; push manually when ready.
- The script expects a clean working tree and prompts if you are not on `master`
  (unless you use `--dry-run`, which skips branch checks).

