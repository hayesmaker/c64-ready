#!/usr/bin/env bash
# Publish docs/*.md and CHANGELOG.md to the repository GitHub Wiki.
# Usage:   ./tools/publish_wiki.sh <wiki-git-url>
# Example: ./tools/publish_wiki.sh git@github.com:youruser/c64-ready.wiki.git

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <wiki-git-url>"
  exit 1
fi

WIKI_URL="$1"
TMPDIR=$(mktemp -d)
WIKI_DIR="$TMPDIR/wiki"

echo "Cloning wiki into $WIKI_DIR"
git clone "$WIKI_URL" "$WIKI_DIR"

echo "Copying docs/*.md into wiki"
cp docs/*.md "$WIKI_DIR/"

echo "Copying CHANGELOG.md into wiki"
if [ -f CHANGELOG.md ]; then
  cp CHANGELOG.md "$WIKI_DIR/"
fi

cd "$WIKI_DIR"

# ---------------------------------------------------------------------------
# Build Home.md from scratch
# ---------------------------------------------------------------------------
printf '# c64-ready Wiki\n\nCommodore 64 emulator for the browser and Node.js.\n\n## Documentation\n\n' > Home.md

declare -A TITLES
TITLES["PROJECT_OVERVIEW.md"]="Project Overview"
TITLES["AUDIO_ENGINE.md"]="Audio Engine"
TITLES["HEADLESS_RUNNING.md"]="Headless Running"
TITLES["HEADLESS_INPUT.md"]="Headless Input API"
TITLES["CHANGELOG_RELEASES.md"]="Changelog & Releases"
TITLES["WIKI_PUBLISHING.md"]="Wiki Publishing"
TITLES["CHANGELOG.md"]="Changelog"

ORDER=(
  PROJECT_OVERVIEW.md
  AUDIO_ENGINE.md
  HEADLESS_RUNNING.md
  HEADLESS_INPUT.md
  CHANGELOG_RELEASES.md
  WIKI_PUBLISHING.md
  CHANGELOG.md
)

for file in "${ORDER[@]}"; do
  if [ -f "$file" ]; then
    title="${TITLES[$file]}"
    page="${file%.md}"
    echo "- [${title}](${page// /%20})" >> Home.md
  fi
done

# Append any docs not in ORDER (future-proofing)
for f in ./*.md; do
  [ "$f" = "./Home.md" ] && continue
  base=$(basename "$f")
  found=0
  for o in "${ORDER[@]}"; do [ "$o" = "$base" ] && found=1 && break; done
  if [ "$found" = "0" ]; then
    title=$(sed -n '/^#/{s/^#\s*//;p;q}' "$f")
    [ -z "$title" ] && title="${base%.md}"
    page="${base%.md}"
    echo "- [${title}](${page// /%20})" >> Home.md
  fi
done

echo ""
echo "Generated Home.md:"
cat Home.md

# ---------------------------------------------------------------------------
git add .
git commit -m "chore(wiki): sync docs/ -> wiki" || echo "Nothing to commit"

echo ""
echo "Prepared wiki in $WIKI_DIR"
echo "To publish, run:"
echo "  cd $WIKI_DIR && git push origin HEAD"
