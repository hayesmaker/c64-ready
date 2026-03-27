# Wiki Publishing

Human-facing documentation lives in the `docs/` folder at the repository root
(except `AGENTS.md` and `README.md`, which remain in root). The `tools/publish_wiki.sh`
script syncs that folder to the GitHub repository wiki.

## How it works

`tools/publish_wiki.sh` will:

1. Clone the wiki repository into a temporary directory
2. Copy `docs/*.md` and the root `CHANGELOG.md` into the wiki clone
3. Update (or create) `Home.md` with links to each page
4. Commit the changes so you can review before pushing

The script never pushes automatically — it prints the path to the prepared clone so you
can inspect and push when ready.

## Prepare a wiki update locally (no push)

```bash
./tools/publish_wiki.sh git@github.com:YOUR_USER/c64-ready.wiki.git

# Inspect the prepared wiki clone (the script prints where it wrote files)
cd /tmp/<the-script-printed-path>/wiki
git status
git show --name-only
```

## Publish to the GitHub wiki

```bash
cd /tmp/<the-script-printed-path>/wiki
git push origin HEAD
```

## CI automation

The `.github/workflows/publish_wiki.yml` workflow runs on every push to `master` and
publishes `PROJECT_OVERVIEW.md` to the wiki automatically, so the wiki stays up to date
without any manual steps for routine doc changes.

## Adding new docs pages

1. Create a `.md` file in `docs/`
2. Run `tools/publish_wiki.sh` (or let CI do it on the next push to `master`)
3. The script will pick up the new file and add a link to `Home.md` automatically

