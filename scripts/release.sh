#!/bin/bash
set -e

# Usage: ./scripts/release.sh [patch|minor|major]
# Default: patch

BUMP=${1:-patch}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. Bump version via npm (creates git commit + tag)
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
git add package.json
git commit -m "v${VERSION}"
git tag "v${VERSION}"

# 2. Build zip (exclude .git, node_modules, etc.)
ZIP_NAME="hanako-plugin-code-agent-v${VERSION}.zip"
rm -f "../${ZIP_NAME}"
zip -r "../${ZIP_NAME}" . \
  -x ".git/*" ".gitignore" "*.log" ".DS_Store" "node_modules/*" "scripts/*"

# 3. Push commit + tag
git push && git push --tags

# 4. Create GitHub release with zip
gh release create "v${VERSION}" \
  --title "v${VERSION}" \
  --generate-notes \
  "../${ZIP_NAME}"

echo "Released v${VERSION}"
