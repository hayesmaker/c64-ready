#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: release.sh [patch|minor|major|<version>] [--no-push] [--dry-run] [--preid <id>]

Examples:
  ./tools/release.sh patch        # bump patch, commit, tag, push
  ./tools/release.sh minor --no-push  # bump minor, but don't push
  ./tools/release.sh 1.2.3       # set explicit version 1.2.3

This script runs `npm version` (which updates package.json and creates a git tag),
then pushes the commit and tags to origin/master. By default it requires a clean
working tree and that you are on branch 'master'. Use --no-push to skip pushing
or --dry-run to only show the commands that would be run.
USAGE
}

if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
  usage
  exit 0
fi

# Parse args: flags can appear anywhere. First non-flag arg is TYPE.
TYPE=""
NO_PUSH=0
DRY_RUN=0
PREID=""
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-push)
      NO_PUSH=1; shift ;;
    --dry-run)
      DRY_RUN=1; shift ;;
    --preid)
      PREID="$2"; shift 2 ;;
    --preid=*)
      PREID="${1#--preid=}"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    --*)
      echo "Unknown option: $1"; usage; exit 1 ;;
    *)
      POSITIONAL+=("$1"); shift ;;
  esac
done

if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
  TYPE=${POSITIONAL[0]}
else
  TYPE=patch
fi

echo "Release helper: mode=${TYPE}, no_push=${NO_PUSH}, dry_run=${DRY_RUN}"

if [[ "$DRY_RUN" -ne 1 ]]; then
  # Ensure we're on master
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$BRANCH" != "master" ]]; then
    echo "Warning: you are on branch '$BRANCH' (expected 'master')."
    read -p "Continue anyway? [y/N] " ans
    case "$ans" in
      y|Y) echo "Continuing on $BRANCH" ;;
      *) echo "Aborting."; exit 1 ;;
    esac
  fi

  # Ensure working tree is clean
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree not clean. Please commit or stash changes before releasing." >&2
    git status --porcelain
    exit 1
  fi
else
  echo "Dry run mode: skipping branch and working-tree checks."
fi

# Build the npm version command
# Build npm version command; include --preid when provided (used for prerelease)
NPM_CMD=(npm version)
if [[ -n "$PREID" ]]; then
  NPM_CMD+=(--preid="$PREID")
fi
NPM_CMD+=("$TYPE" -m "chore(release): %s")

echo "Running: ${NPM_CMD[*]}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run: not executing npm version.";
  # Compute the version that WOULD be created by `npm version` for common bump types
  # Use node to safely parse package.json and compute an incremented semver
  PREDICTED_VERSION=$(node - "$TYPE" "$PREID" <<'NODE'
const args = process.argv.slice(2);
const type = args[0] || "";
const preid = args[1] || "";
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json','utf8'));
const semver = (pkg.version||'0.0.0');
const m = semver.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-.]+))?$/);
if(!m){ console.log(pkg.version||'0.0.0'); process.exit(0) }
let major = parseInt(m[1],10), minor = parseInt(m[2],10), patch = parseInt(m[3],10);
const pre = m[4] || null;
function bumpBasic(t){
  if(t==='patch'){ patch += 1; return `${major}.${minor}.${patch}` }
  if(t==='minor'){ minor += 1; patch = 0; return `${major}.${minor}.${patch}` }
  if(t==='major'){ major += 1; minor = 0; patch = 0; return `${major}.${minor}.${patch}` }
  return null
}
if(/^pre(?:patch|minor|major|release)?$/.test(type)){
  if(type === 'prerelease'){
    if(pre){
      const parts = pre.split('.')
      const id = parts[0]
      const num = parseInt(parts[1]||'0',10)
      if(preid && id === preid){ console.log(`${major}.${minor}.${patch}-${id}.${num+1}`); process.exit(0) }
      else if(preid){ console.log(`${major}.${minor}.${patch}-${preid}.0`); process.exit(0) }
      else if(/^[0-9]+$/.test(id)){ console.log(`${major}.${minor}.${patch}-${num+1}`); process.exit(0) }
      else { console.log(`${major}.${minor}.${patch}-${id}.${num+1}`); process.exit(0) }
    } else {
      patch += 1
      if(preid) console.log(`${major}.${minor}.${patch}-${preid}.0`)
      else console.log(`${major}.${minor}.${patch}-0`)
      process.exit(0)
    }
  } else {
    const t = type.replace(/^pre/,'')
    const basev = bumpBasic(t)
    if(preid) console.log(`${basev}-${preid}.0`)
    else console.log(`${basev}-0`)
    process.exit(0)
  }
}
const basic = bumpBasic(type)
if(basic){ console.log(basic); process.exit(0) }
if(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(type)){ console.log(type); process.exit(0) }
console.log(pkg.version||'0.0.0')
NODE
  ) || PREDICTED_VERSION="$(node -p "require('./package.json').version")"
  echo "Predicted new version: ${PREDICTED_VERSION} (would create tag v${PREDICTED_VERSION})"
else
  "${NPM_CMD[@]}"

  # After npm version created the release commit+tag, generate the changelog locally
  # and include it in the release commit (so no separate changelog PR is created).
  echo "Generating changelog and amending release commit..."
  # Determine the new version and tag now that npm version ran
  NEW_VERSION=$(node -p "require('./package.json').version")
  TAG="v${NEW_VERSION}"

  if command -v node >/dev/null 2>&1 && [[ -f tools/generate_changelog.js ]]; then
    # Run the changelog generator in local/write-only mode so it doesn't attempt to push or create a PR
    node tools/generate_changelog.js --local || true

    # If the generator produced changes to CHANGELOG.md (staged or unstaged), amend the release commit to include them
    if git diff --name-only -- CHANGELOG.md | grep -q . || git diff --name-only --cached -- CHANGELOG.md | grep -q .; then
      # stage CHANGELOG.md (in case generator wrote it but didn't stage)
      git add CHANGELOG.md || true
      # Amend the last commit (the release commit created by npm version)
      git commit --amend --no-edit || true
      # Move the tag to point to the amended commit
      git tag -f "${TAG}"
      echo "Amended release commit to include CHANGELOG.md and moved tag ${TAG} to amended commit."
    else
      echo "No changelog changes detected; leaving release commit as-is."
    fi
  else
    echo "Changelog generator not available; skipping local changelog generation."
  fi
fi

# If dry-run, show the predicted version instead of the unchanged package.json version
if [[ "$DRY_RUN" -eq 1 ]]; then
  # NEW_VERSION may not be set in dry-run; fall back to package.json
  NEW_VERSION=${NEW_VERSION:-$(node -p "require('./package.json').version")}
  echo "(Note: package.json unchanged in dry-run) Current package.json version: ${NEW_VERSION}"
  echo "Predicted version when not in dry-run: ${PREDICTED_VERSION} (tag: v${PREDICTED_VERSION})"
else
  echo "New version: ${NEW_VERSION} (tag: ${TAG})"
fi

if [[ "$NO_PUSH" -eq 1 ]]; then
  echo "--no-push specified; skipping git push. Done.";
  exit 0
fi

# Push commit and tags
PUSH_CMD_1=(git push origin master)
# Ensure TAG is set (may be undefined in dry-run)
TAG=${TAG:-v${PREDICTED_VERSION:-$(node -p "require('./package.json').version")}}
# After amending tag we must force-push the tag to update remote
PUSH_CMD_2=(git push --force origin "${TAG}")

echo "Pushing to origin master and tags..."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run: ${PUSH_CMD_1[*]}"
  echo "Dry run: ${PUSH_CMD_2[*]}"
else
  "${PUSH_CMD_1[@]}"
  "${PUSH_CMD_2[@]}"
  echo "Push complete."
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run complete. Predicted release: v${PREDICTED_VERSION}. (package.json unchanged)"
  echo "When running without --dry-run the script will create tag v${PREDICTED_VERSION} and push it to origin/master."
else
  echo "Release ${TAG} complete. Create a GitHub Release from the tag via the web UI when ready."
fi

