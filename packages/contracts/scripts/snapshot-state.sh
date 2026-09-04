#!/usr/bin/env bash
# Prints a JSON snapshot of the on-chain state the deployment depends on, read through the official RPC.
# Usage: scripts/snapshot-state.sh > deployments/backups/<timestamp>/state.json
# shellcheck disable=SC1091
. "$(dirname "$0")/env.sh"
require_env RPC_URL_4663

DEPLOYMENTS="deployments/4663.json"
RPC="$RPC_URL_4663"
BLOCK="$(cast block-number --rpc-url "$RPC")"

call() { cast call "$1" "$2" --rpc-url "$RPC" 2>/dev/null || echo null; }
codehash() { cast keccak "$(cast code "$1" --rpc-url "$RPC")"; }

echo "{"
echo "  \"takenAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
echo "  \"block\": $BLOCK,"
echo "  \"safe\": \"${SAFE_ADDRESS:-}\","
echo "  \"contracts\": {"
if [ -f "$DEPLOYMENTS" ]; then
  first=1
  for name in $(jq -r '.contracts | keys[]' "$DEPLOYMENTS"); do
    addr="$(jq -r ".contracts[\"$name\"].address" "$DEPLOYMENTS")"
    [ "$addr" = "null" ] && continue
    [ $first -eq 1 ] || echo ","
    first=0
    printf '    "%s": {\n      "address": "%s",\n      "owner": "%s",\n      "codeHash": "%s"' \
      "$name" "$addr" "$(call "$addr" 'owner()(address)')" "$(codehash "$addr")"
    case "$name" in
      BurnVault)
        printf ',\n      "token": "%s",\n      "ethRouteUsesWeth": "%s",\n      "tierCost": {"1": "%s", "2": "%s", "3": "%s"}' \
          "$(call "$addr" 'token()(address)')" "$(call "$addr" 'ethRouteUsesWeth()(bool)')" \
          "$(call "$addr" 'tierCost(uint8)(uint256)' 1)" "$(call "$addr" 'tierCost(uint8)(uint256)' 2)" "$(call "$addr" 'tierCost(uint8)(uint256)' 3)"
        ;;
      CreatorRegistry)
        printf ',\n      "verifier": "%s"' "$(call "$addr" 'verifier()(address)')"
        ;;
      BudgetAccountFactory)
        printf ',\n      "implementation": "%s"' "$(call "$addr" 'implementation()(address)')"
        ;;
    esac
    printf '\n    }'
  done
  echo
fi
echo "  }"
echo "}"
