#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: release.sh [patch|minor|major|<version>] [--no-push] [--dry-run]

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
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --no-push)
      NO_PUSH=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $arg"; usage; exit 1
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
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
NPM_CMD=(npm version "$TYPE" -m "chore(release): %s")

echo "Running: ${NPM_CMD[*]}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run: not executing npm version.";
else
  "${NPM_CMD[@]}"
fi

# Determine the new version and tag
NEW_VERSION=$(node -p "require('./package.json').version")
TAG="v${NEW_VERSION}"
echo "New version: ${NEW_VERSION} (tag: ${TAG})"

if [[ "$NO_PUSH" -eq 1 ]]; then
  echo "--no-push specified; skipping git push. Done.";
  exit 0
fi

# Push commit and tags
PUSH_CMD_1=(git push origin master)
PUSH_CMD_2=(git push --tags)

echo "Pushing to origin master and tags..."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run: ${PUSH_CMD_1[*]}"
  echo "Dry run: ${PUSH_CMD_2[*]}"
else
  "${PUSH_CMD_1[@]}"
  "${PUSH_CMD_2[@]}"
  echo "Push complete."
fi

echo "Release ${TAG} complete. Create a GitHub Release from the tag via the web UI when ready."

