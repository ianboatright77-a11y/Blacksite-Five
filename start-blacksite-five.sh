#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Blacksite Five needs Node.js 20 or newer: https://nodejs.org/en/download' >&2
  exit 1
fi

node server.js &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
sleep 1

if command -v open >/dev/null 2>&1; then
  open 'http://localhost:4173'
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open 'http://localhost:4173' >/dev/null 2>&1 || true
fi

wait "$server_pid"
