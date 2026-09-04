#!/usr/bin/env bash
# Deploys one protocol contract or all of them to Robinhood Chain mainnet.
#
# Usage: scripts/deploy.sh <factory|vault|registry|all> [--broadcast]
#
# Without --broadcast the script stops after the simulation. With it, the sequence is:
#   1. snapshot deployments/4663.json and dependent on-chain state into deployments/backups/<timestamp>/, commit
#   2. run the fork test suites on an anvil fork
#   3. simulate the deploy script against the official RPC
#   4. broadcast through the official RPC (never the archive endpoint)
#   5. record address, tx hash, and block in deployments/4663.json
#   6. verify source on Blockscout, falling back to Sourcify (which Blockscout imports)
#   7. assert owner() == SAFE_ADDRESS for every deployed contract, commit the record
# shellcheck disable=SC1091
. "$(dirname "$0")/env.sh"

TARGET="${1:-}"
MODE="${2:-simulate}"
case "$TARGET" in
  factory)  SCRIPT=DeployBudgetAccountFactory ;;
  vault)    SCRIPT=DeployBurnVault ;;
  registry) SCRIPT=DeployCreatorRegistry ;;
  all)      SCRIPT=DeployAll ;;
  *) echo "usage: scripts/deploy.sh <factory|vault|registry|all> [--broadcast]" >&2; exit 1 ;;
esac
if [ "$MODE" != "simulate" ] && [ "$MODE" != "--broadcast" ]; then
  echo "second argument must be --broadcast or omitted" >&2; exit 1
fi

require_env SAFE_ADDRESS DEPLOYER_PRIVATE_KEY
if [ "$TARGET" = "registry" ] || [ "$TARGET" = "all" ]; then require_env VERIFIER_ADDRESS; fi
require_official_rpc
RPC="$RPC_URL_4663"
USDG="$(jq -r .usdg config/4663.json)"
WETH="$(jq -r .weth config/4663.json)"
POOL_MANAGER="$(jq -r .uniswapV4.poolManager config/4663.json)"
SWAP_ROUTER="$(jq -r .uniswapV3.swapRouter02 config/4663.json)"
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
echo "deployer $DEPLOYER balance $(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether) ETH"
echo "safe     $SAFE_ADDRESS threshold $(cast call "$SAFE_ADDRESS" 'getThreshold()(uint256)' --rpc-url "$RPC")"

mkdir -p deployments/backups
[ -f deployments/4663.json ] || echo '{ "chainId": 4663, "contracts": {} }' > deployments/4663.json

if [ "$MODE" = "--broadcast" ]; then
  if [ -n "$(git status --porcelain -- . ':!deployments' ':!broadcast')" ]; then
    echo "working tree has uncommitted changes outside deployments/; commit them first" >&2; exit 1
  fi
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP="deployments/backups/$STAMP"
  mkdir -p "$BACKUP"
  cp deployments/4663.json "$BACKUP/4663.json"
  scripts/snapshot-state.sh > "$BACKUP/state.json"
  git add "$BACKUP"
  git commit -q --no-verify -m "chore(deploy): snapshot before deploying $TARGET"
  echo "snapshot committed to $BACKUP"

  scripts/fork-test.sh
fi

echo "simulating $SCRIPT"
forge script "script/$SCRIPT.s.sol" --rpc-url "$RPC"
if [ "$MODE" != "--broadcast" ]; then
  echo "simulation ok; rerun with --broadcast to deploy"
  exit 0
fi

echo "broadcasting $SCRIPT through $RPC"
forge script "script/$SCRIPT.s.sol" --rpc-url "$RPC" --broadcast --slow

RUN="broadcast/$SCRIPT.s.sol/4663/run-latest.json"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

record() { # name address txHash constructorArgs
  local block
  block="$(jq -r --arg h "$3" '.receipts[] | select(.transactionHash == $h) | .blockNumber' "$RUN" | head -1)"
  block=$((block))
  jq --arg n "$1" --arg a "$2" --arg h "$3" --arg c "$4" --argjson b "$block" --arg t "$NOW" \
     '.contracts[$n] = {address: $a, txHash: $h, block: $b, deployedAt: $t, constructorArgs: $c, verified: "pending"}' \
     deployments/4663.json > deployments/4663.json.tmp && mv deployments/4663.json.tmp deployments/4663.json
}

verify() { # name address constructorArgs path:Contract
  local status="none"
  if forge verify-contract --chain-id 4663 --verifier blockscout --verifier-url "$EXPLORER/api/" \
       --constructor-args "$3" --watch "$2" "$4"; then
    status="blockscout"
  elif forge verify-contract --chain-id 4663 --verifier sourcify --constructor-args "$3" --watch "$2" "$4"; then
    status="sourcify"
  else
    echo "verification failed for $1 at $2; upload manually with: forge verify-contract --show-standard-json-input $2 $4" >&2
  fi
  jq --arg n "$1" --arg s "$status" '.contracts[$n].verified = $s' deployments/4663.json > deployments/4663.json.tmp \
    && mv deployments/4663.json.tmp deployments/4663.json
}

assert_owner() { # name address
  local owner
  owner="$(cast call "$2" 'owner()(address)' --rpc-url "$RPC")"
  if [ "$(cast to-check-sum-address "$owner")" != "$(cast to-check-sum-address "$SAFE_ADDRESS")" ]; then
    echo "OWNER MISMATCH: $1 at $2 is owned by $owner, expected $SAFE_ADDRESS" >&2; exit 1
  fi
  echo "$1 owner is the Safe"
}

while IFS=$'\t' read -r name addr hash; do
  case "$name" in
    BudgetAccountFactory)
      args="$(cast abi-encode 'constructor(address,address)' "$USDG" "$SAFE_ADDRESS")"
      record "$name" "$addr" "$hash" "$args"
      impl="$(cast call "$addr" 'implementation()(address)' --rpc-url "$RPC")"
      jq --arg i "$impl" '.contracts.BudgetAccountFactory.implementation = $i' deployments/4663.json > deployments/4663.json.tmp \
        && mv deployments/4663.json.tmp deployments/4663.json
      verify "$name" "$addr" "$args" src/BudgetAccountFactory.sol:BudgetAccountFactory
      forge verify-contract --chain-id 4663 --verifier blockscout --verifier-url "$EXPLORER/api/" \
        --constructor-args "$(cast abi-encode 'constructor(address)' "$USDG")" --watch "$impl" src/BudgetAccount.sol:BudgetAccount \
        || forge verify-contract --chain-id 4663 --verifier sourcify \
             --constructor-args "$(cast abi-encode 'constructor(address)' "$USDG")" --watch "$impl" src/BudgetAccount.sol:BudgetAccount \
        || echo "verification of the BudgetAccount implementation failed; upload manually" >&2
      assert_owner "$name" "$addr" ;;
    BurnVault)
      args="$(cast abi-encode 'constructor(address,address,address,address,address)' "$POOL_MANAGER" "$SWAP_ROUTER" "$USDG" "$WETH" "$SAFE_ADDRESS")"
      record "$name" "$addr" "$hash" "$args"
      verify "$name" "$addr" "$args" src/BurnVault.sol:BurnVault
      assert_owner "$name" "$addr" ;;
    CreatorRegistry)
      args="$(cast abi-encode 'constructor(address,address,address)' "$USDG" "$VERIFIER_ADDRESS" "$SAFE_ADDRESS")"
      record "$name" "$addr" "$hash" "$args"
      verify "$name" "$addr" "$args" src/CreatorRegistry.sol:CreatorRegistry
      assert_owner "$name" "$addr" ;;
  esac
done < <(jq -r '.transactions[] | select(.transactionType == "CREATE") | [.contractName, .contractAddress, .hash] | @tsv' "$RUN")

git add deployments/4663.json "broadcast/$SCRIPT.s.sol/4663/run-latest.json"
git commit -q --no-verify -m "chore(deploy): deploy $TARGET to 4663"
echo "done; deployments/4663.json updated and committed"
