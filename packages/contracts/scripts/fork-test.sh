#!/usr/bin/env bash
# Runs the fork test suites against a local anvil fork of Robinhood Chain.
# Usage: scripts/fork-test.sh [extra forge test args]
# shellcheck disable=SC1091
. "$(dirname "$0")/env.sh"

SOURCE="$(fork_source_rpc)"
PORT="${ANVIL_PORT:-8546}"
LOG="$(mktemp)"

anvil --fork-url "$SOURCE" --port "$PORT" --silent > "$LOG" 2>&1 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true; rm -f "$LOG"' EXIT

for _ in $(seq 1 60); do
  if curl -s -m 3 -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q 0x1237; then
    break
  fi
  sleep 1
done

echo "anvil forked from $SOURCE on port $PORT"
FORK_RPC_URL="http://127.0.0.1:$PORT" forge test --match-path 'test/fork/*' "$@"
