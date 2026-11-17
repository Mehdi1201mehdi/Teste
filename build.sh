#!/usr/bin/env bash
# Build de publication : minifie le code de brigade-verte-v3 (JS, CSS,
# service worker). Utilisé par Cloudflare Pages et par le workflow GitHub.
set -euo pipefail

# Empreinte du contenu publié, ajoutée à la VERSION du service worker : un
# fichier modifié = nouvelle version = mise à jour sur les appareils.
H=$(cd brigade-verte-v3 && find . -type f ! -name service-worker.js \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.geojson' -o -name '*.webmanifest' -o -name '*.svg' \) -print0 | sort -z | xargs -0 cat | sha256sum | cut -c1-10)
sed -i "s/const VERSION = \"\([^\"-]*\)[^\"]*\"/const VERSION = \"\1-$H\"/" brigade-verte-v3/service-worker.js
echo "Version du cache : $(grep -o 'const VERSION = "[^"]*"' brigade-verte-v3/service-worker.js)"
if [ "${1:-}" = "--version-only" ]; then exit 0; fi

npx --yes esbuild@0.25.0 brigade-verte-v3/js/*.js --minify --format=esm --outdir=brigade-verte-v3/js --allow-overwrite
npx --yes esbuild@0.25.0 brigade-verte-v3/service-worker.js --minify --outfile=brigade-verte-v3/service-worker.js --allow-overwrite
npx --yes esbuild@0.25.0 brigade-verte-v3/css/*.css --minify --outdir=brigade-verte-v3/css --allow-overwrite

echo "Build minifié prêt dans brigade-verte-v3/"
