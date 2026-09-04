#!/usr/bin/env bash
# End-to-end check of the Sinkhole image on a host that has Docker, dig and curl.
# Builds the image (unless SKIP_BUILD=1), starts a container with a temporary data directory and a manual
# blocklist, pushes an extension blocklist, and checks answers from the resolver. Exits non-zero on failure.
set -euo pipefail

IMAGE="${IMAGE:-payhole-sinkhole}"
NAME="payhole-sinkhole-test-$$"
DNS_PORT="${TEST_DNS_PORT:-5553}"
ADMIN_PORT="${TEST_ADMIN_PORT:-18053}"
UPSTREAM="${TEST_UPSTREAM_DNS:-1.1.1.1}"
TOKEN="test-$(date +%s)-$RANDOM"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"
chmod 755 "$TMP"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

for tool in docker dig curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing required tool: $tool" >&2; exit 1; }
done

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "building $IMAGE from $ROOT"
  docker build -f "$ROOT/packages/sinkhole/Dockerfile" -t "$IMAGE" "$ROOT"
fi

printf 'blocked.example\n# a comment line\n' > "$TMP/manual.txt"

echo "starting $NAME (dns 127.0.0.1:$DNS_PORT, admin 127.0.0.1:$ADMIN_PORT)"
docker run -d --name "$NAME" \
  -e ADMIN_TOKEN="$TOKEN" \
  -e SWARM_ENABLED="${TEST_SWARM_ENABLED:-0}" \
  -e MIN_TIER=0 \
  -e MANUAL_BLOCKLIST_FILE=/data/manual.txt \
  -e UPSTREAM_DNS="$UPSTREAM" \
  -p "127.0.0.1:$DNS_PORT:53/udp" \
  -p "127.0.0.1:$DNS_PORT:53/tcp" \
  -p "127.0.0.1:$ADMIN_PORT:8053/tcp" \
  -v "$TMP:/data" \
  "$IMAGE" >/dev/null

echo "waiting for /healthz"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$ADMIN_PORT/healthz" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" = 60 ]; then
    echo "FAIL: container did not become healthy" >&2
    docker logs "$NAME" >&2
    exit 1
  fi
  sleep 1
done

echo "pushing an extension blocklist with tracker.example"
curl -fsS -X PUT "http://127.0.0.1:$ADMIN_PORT/api/blocklist" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"version":1,"updatedAt":"2026-01-01T00:00:00.000Z","entries":[{"domain":"tracker.example","reason":"container test","flaggedAt":"2026-01-01T00:00:00.000Z"}]}' \
  >/dev/null

resolve() {
  dig @127.0.0.1 -p "$DNS_PORT" +short +time=3 +tries=1 "$1" A 2>/dev/null | head -n1
}

expect_sunk() {
  local name="$1" answer=""
  for _ in $(seq 1 20); do
    answer="$(resolve "$name")"
    if [ "$answer" = "0.0.0.0" ]; then
      echo "ok: $name -> 0.0.0.0"
      return 0
    fi
    sleep 0.5
  done
  echo "FAIL: $name resolved to '$answer' instead of 0.0.0.0" >&2
  docker logs "$NAME" >&2
  return 1
}

expect_sunk tracker.example
expect_sunk sub.tracker.example
expect_sunk blocked.example

answer="$(resolve example.com)"
case "$answer" in
  ""|0.0.0.0)
    echo "FAIL: example.com resolved to '$answer'; upstream $UPSTREAM may be unreachable" >&2
    docker logs "$NAME" >&2
    exit 1
    ;;
  *)
    echo "ok: example.com -> $answer"
    ;;
esac

export_plain="$(curl -fsS "http://127.0.0.1:$ADMIN_PORT/api/blocklist/export?format=plain" -H "authorization: Bearer $TOKEN")"
for name in tracker.example blocked.example; do
  if ! printf '%s\n' "$export_plain" | grep -qx "$name"; then
    echo "FAIL: export does not list $name" >&2
    exit 1
  fi
done
echo "ok: export lists tracker.example and blocked.example"

if curl -fsS "http://127.0.0.1:$ADMIN_PORT/api/status" >/dev/null 2>&1; then
  echo "FAIL: /api/status answered without a token" >&2
  exit 1
fi
echo "ok: api refuses requests without the token"

curl -fsS "http://127.0.0.1:$ADMIN_PORT/api/status" -H "authorization: Bearer $TOKEN"
echo
echo "container test passed"
