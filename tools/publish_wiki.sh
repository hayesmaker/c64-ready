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

echo "Removing stale markdown pages from wiki clone"
rm -f "$WIKI_DIR"/*.md

echo "Copying docs/*.md into wiki"
cp docs/*.md "$WIKI_DIR/"

echo "Copying CHANGELOG.md into wiki"
if [ -f CHANGELOG.md ]; then
  cp CHANGELOG.md "$WIKI_DIR/"
fi

cd "$WIKI_DIR"

# ---------------------------------------------------------------------------
# Build Home.md from scratch.
# Titles are read from the first # heading of each file — no hardcoded list needed.
# Order: PROJECT_OVERVIEW first, CHANGELOG last, everything else alphabetically between.
# ---------------------------------------------------------------------------
printf '# c64-ready Wiki\n\nCommodore 64 emulator for the browser and Node.js.\n\n## Documentation\n\n' > Home.md

emit_link() {
  local file="$1"
  local title
  title=$(grep -m1 '^# ' "$file" | sed 's/^# //')
  [ -z "$title" ] && title="${file%.md}"
  local page="${file%.md}"
  echo "- [${title}](${page// /%20})" >> Home.md
}

# Pin PROJECT_OVERVIEW first
[ -f PROJECT_OVERVIEW.md ] && emit_link PROJECT_OVERVIEW.md

# All other docs alphabetically, excluding pinned files
for f in $(printf '%s\n' *.md | sort); do
  [ "$f" = "Home.md" ]             && continue
  [ "$f" = "PROJECT_OVERVIEW.md" ] && continue
  [ "$f" = "CHANGELOG.md" ]        && continue
  emit_link "$f"
done

# Pin CHANGELOG last
[ -f CHANGELOG.md ] && emit_link CHANGELOG.md

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
