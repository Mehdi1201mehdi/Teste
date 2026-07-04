#!/usr/bin/env bash
# Build de publication : minifie le code de brigade-verte-v3 (JS, CSS,
# service worker). Utilisé par Cloudflare Pages et par le workflow GitHub.
set -euo pipefail

npx --yes esbuild@0.25.0 brigade-verte-v3/js/*.js --minify --format=esm --outdir=brigade-verte-v3/js --allow-overwrite
npx --yes esbuild@0.25.0 brigade-verte-v3/service-worker.js --minify --outfile=brigade-verte-v3/service-worker.js --allow-overwrite
npx --yes esbuild@0.25.0 brigade-verte-v3/css/*.css --minify --outdir=brigade-verte-v3/css --allow-overwrite

echo "Build minifié prêt dans brigade-verte-v3/"
