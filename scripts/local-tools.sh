#!/usr/bin/env bash
# Downloads the real Supabase Auth (GoTrue) and PostgREST servers used by the local stack into .local/bin.
# Linux x86-64 builds. On macOS, install them instead: `brew install postgrest` and build Auth from
# https://github.com/supabase/auth, then place both binaries (named auth and postgrest) in .local/bin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/.local/bin"
AUTH_VERSION=v2.177.0
POSTGREST_VERSION=v12.2.3
mkdir -p "$BIN" "$ROOT/.local/dl"
cd "$ROOT/.local/dl"
if [ ! -x "$BIN/postgrest" ]; then
  curl -fsSL -o postgrest.tar.xz "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz"
  tar -xJf postgrest.tar.xz -C "$BIN"
fi
if [ ! -x "$BIN/auth" ]; then
  curl -fsSL -o auth.tar.gz "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz"
  tar -xzf auth.tar.gz
  mv auth migrations "$BIN/"
  rm -f gotrue
fi
echo "Local tools in $BIN: $(ls "$BIN" | tr '\n' ' ')"
