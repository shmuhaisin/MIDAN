#!/usr/bin/env bash
# Windows (Git Bash) counterpart of scripts/local-tools.sh: the same Supabase Auth and PostgREST versions, as native
# Windows programs, in .local/bin. No administrator rights, no WSL, no Docker. See docs/local-development-windows.md.
#
#   scripts/local-tools-windows.sh
#
# PostgREST: the official Windows release. Supabase Auth has no Windows release, so it's built from its tagged source with
# a portable Go (go.dev zip, checksum checked), after moving one Unix-only socket option into build-tagged files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
L="$ROOT/.local"
BIN="$L/bin"
AUTH_VERSION=v2.177.0
POSTGREST_VERSION=v12.2.3
GO_VERSION=go1.26.10
GO_SHA256=7ecd2d7260e82c59bcbd7f1077a07cee2dea607295b858df67195a1e4e09629b
# PostgREST publishes no checksum file; this is the archive this setup was verified with.
POSTGREST_SHA256=a850cd1cf5b208972f4db2803656c645436ad333882480685e052d45706c1966
mkdir -p "$BIN" "$L/downloads" "$L/tools" "$L/src"
cd "$L/downloads"

if [ ! -f "$BIN/postgrest.exe" ]; then
  curl -fsSL -o postgrest.zip "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-windows-x64.zip"
  echo "$POSTGREST_SHA256  postgrest.zip" | sha256sum -c -
  rm -rf postgrest && mkdir postgrest && (cd postgrest && unzip -q ../postgrest.zip)
  cp "$(find postgrest -name postgrest.exe | head -1)" "$BIN/"
fi

if [ ! -f "$BIN/auth.exe" ]; then
  if [ ! -x "$L/tools/go/bin/go.exe" ]; then
    curl -fsSL -o go.zip "https://go.dev/dl/$GO_VERSION.windows-amd64.zip"
    echo "$GO_SHA256  go.zip" | sha256sum -c -
    rm -rf "$L/tools/go" && (cd "$L/tools" && unzip -q "$L/downloads/go.zip")
  fi
  rm -rf "$L/src/auth"
  git clone -q --depth 1 --branch "$AUTH_VERSION" https://github.com/supabase/auth.git "$L/src/auth"
  cd "$L/src/auth"
  # SO_REUSEPORT doesn't exist on Windows. Unix keeps the original code; Windows sets nothing (one server, one port).
  python - <<'PY'
p = 'cmd/serve_cmd.go'
s = open(p, encoding='utf8').read()
start = s.index('\t\tControl: func(network, address string, c syscall.RawConn) error {')
end = s.index('\t\t},\n', start) + len('\t\t},\n')
s = s[:start] + '\t\tControl: reusePort, // reuseport_unix.go, reuseport_windows.go\n' + s[end:]
s = s.replace('\t"golang.org/x/sys/unix"\n', '', 1).replace('\t"syscall"\n', '', 1)
open(p, 'w', encoding='utf8').write(s)
open('cmd/reuseport_unix.go', 'w', encoding='utf8').write('''//go:build !windows

package cmd

import (
\t"syscall"

\t"golang.org/x/sys/unix"
)

func reusePort(network, address string, c syscall.RawConn) error {
\tvar serr error
\tif err := c.Control(func(fd uintptr) {
\t\tserr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
\t}); err != nil {
\t\treturn err
\t}
\treturn serr
}
''')
open('cmd/reuseport_windows.go', 'w', encoding='utf8').write('''//go:build windows

package cmd

import "syscall"

func reusePort(network, address string, c syscall.RawConn) error { return nil }
''')
PY
  export GOROOT="$L/tools/go" PATH="$L/tools/go/bin:$PATH" GOPATH="$L/go" GOMODCACHE="$L/go/mod" GOCACHE="$L/go/cache" GOTOOLCHAIN=local CGO_ENABLED=0
  go build -o "$BIN/auth.exe" .
  rm -rf "$BIN/migrations" && cp -r migrations "$BIN/migrations"
fi
echo "Local tools in $BIN: $(ls "$BIN" | tr '\n' ' ')"
