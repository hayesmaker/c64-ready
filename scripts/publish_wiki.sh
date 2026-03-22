#!/usr/bin/env bash
# Publish docs/*.md to the repository GitHub Wiki.
# Usage: ./scripts/publish_wiki.sh <git@github.com:OWNER/REPO.wiki.git>
# Example: ./scripts/publish_wiki.sh git@github.com:youruser/c64-ready.wiki.git

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <wiki-git-url>"
  exit 1
fi

WIKI_URL="$1"
TMPDIR=$(mktemp -d)
echo "Cloning wiki into $TMPDIR"
git clone "$WIKI_URL" "$TMPDIR/wiki"

echo "Copying docs/*.md and root CHANGELOG.md into wiki repo"
cp docs/*.md "$TMPDIR/wiki/" || true
if [ -f CHANGELOG.md ]; then
  cp CHANGELOG.md "$TMPDIR/wiki/"
fi

cd "$TMPDIR/wiki"

# Ensure Home.md exists
if [ ! -f Home.md ]; then
  echo "Home.md not found in wiki — creating a simple Home.md"
  cat > Home.md <<'EOF'
# Project Wiki

This wiki contains project documentation.

## Pages

EOF
fi

echo "Updating Home.md with links to docs pages"

# Add links for each markdown file copied into the wiki repo (skip Home.md)
for f in ./*.md; do
  name=$(basename "$f")
  if [ "$name" = "Home.md" ]; then
    continue
  fi
  # Read first non-empty header line as the title, fallback to filename
  title=$(sed -n '1,5p' "$f" | sed -n '/^#/{s/^#\s*//;p;q}')
  if [ -z "$title" ]; then
    title="$name"
  fi
  # Append link if not present
  if ! grep -q "\[${title}\](${name})" Home.md; then
    echo "- [${title}](${name})" >> Home.md
  fi
done

git add .
git commit -m "chore(wiki): sync docs/ -> wiki" || echo "Nothing to commit"

echo "Prepared wiki content in $TMPDIR/wiki"
echo "To publish, run:\n  cd $TMPDIR/wiki && git push origin HEAD"
echo "Or manually inspect and push from $TMPDIR/wiki"

