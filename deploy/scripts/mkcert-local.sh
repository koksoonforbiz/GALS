#!/usr/bin/env sh
# Issue locally-trusted TLS certs for the two-door LOCAL simulation.
#
#   ./deploy/scripts/mkcert-local.sh
#
# Needs mkcert (https://github.com/FiloSottile/mkcert). Run it where the
# BROWSER runs (Windows, if the repo lives under WSL2) so `mkcert -install`
# puts the local CA into that browser's trust store; the files land in
# deploy/certs/ (gitignored) as student.{crt,key} and admin.{crt,key},
# which is what deploy/nginx/templates/gals.conf.template expects.
set -eu

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$repo_root/deploy/certs"
mkdir -p "$out"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert not found — install it first (choco install mkcert / brew install mkcert / apt install mkcert)" >&2
  exit 1
fi

mkcert -install

# One cert per door, each also valid for localhost so https://localhost:8443
# works without hosts-file entries.
mkcert -cert-file "$out/student.crt" -key-file "$out/student.key" student.gals.test localhost 127.0.0.1
mkcert -cert-file "$out/admin.crt"   -key-file "$out/admin.key"   admin.gals.test   localhost 127.0.0.1

echo "certs written to $out"
