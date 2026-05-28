#!/usr/bin/env bash
# Usage:
#   npm run deploy:prod           → npm version patch + deploy
#   npm run deploy:prod -- --minor → npm version minor + deploy
#   npm run deploy:prod -- --major → npm version major + deploy
set -euo pipefail

BUMP="patch"
for arg in "$@"; do
  case "$arg" in
    --minor) BUMP="minor" ;;
    --major) BUMP="major" ;;
  esac
done

echo "▶ Bumping version: ${BUMP}"
npm version "${BUMP}" --no-git-tag-version

VERSION=$(node -p "require('./package.json').version")
echo "▶ Version → ${VERSION}"

git add package.json package-lock.json
git commit -m "chore: bump version to ${VERSION}"

echo "▶ Deploying to production…"
npx vercel --prod --yes
