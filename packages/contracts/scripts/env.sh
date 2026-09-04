#!/usr/bin/env bash
# Shared environment loading and RPC guards for the contracts scripts. Source, do not execute.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

OFFICIAL_RPC="$(jq -r .rpc config/4663.json)"
EXPLORER="$(jq -r .explorer config/4663.json)"

require_env() {
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      echo "missing environment variable: $name" >&2
      exit 1
    fi
  done
}

# The official RPC is the only endpoint broadcasts may use.
require_official_rpc() {
  require_env RPC_URL_4663
  if [ "$RPC_URL_4663" != "$OFFICIAL_RPC" ]; then
    echo "RPC_URL_4663 must be the official endpoint $OFFICIAL_RPC (got $RPC_URL_4663)" >&2
    exit 1
  fi
  if [ -n "${ARCHIVE_RPC_URL_4663:-}" ] && [ "$ARCHIVE_RPC_URL_4663" = "$RPC_URL_4663" ]; then
    echo "ARCHIVE_RPC_URL_4663 must differ from RPC_URL_4663; refusing to broadcast through the archive" >&2
    exit 1
  fi
  local chain
  chain="$(cast chain-id --rpc-url "$RPC_URL_4663")"
  if [ "$chain" != "4663" ]; then
    echo "RPC_URL_4663 answers chain id $chain, expected 4663" >&2
    exit 1
  fi
}

# Endpoint for anvil forks and read-only queries: the archive if configured, else the official RPC.
fork_source_rpc() {
  if [ -n "${ARCHIVE_RPC_URL_4663:-}" ]; then
    echo "$ARCHIVE_RPC_URL_4663"
  else
    require_env RPC_URL_4663
    echo "$RPC_URL_4663"
  fi
}
