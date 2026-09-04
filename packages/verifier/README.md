# @payhole/verifier

Small HTTP service that lets creators register a domain in `CreatorRegistry` without staking anything. It reads a DNS TXT record, checks that it names the wallet, and signs the EIP-712 `Claim` attestation the registry expects. Anyone can then submit `claim(domainHash, wallet, deadline, signature)`.

## How a creator registers

1. Publish a TXT record at `_payhole.<domain>` with the value `payhole=0xYourWallet` (a bare address or `wallet=0x...` also works).
2. `POST /attest` with `{"domain": "example.com", "wallet": "0xYourWallet"}`.
3. Submit the returned `signature` with `domainHash`, `wallet`, and `deadline` to `CreatorRegistry.claim` from any account.

The attestation is bound to the domain's current claim nonce and a deadline (default one hour), so it cannot be replayed after a later claim. Rotating a wallet is the same flow with a new TXT value.

## API

| Route | Response |
|---|---|
| `GET /healthz` | `{ ok, verifier, registry, chainId }` |
| `POST /attest` | `{ domain, domainHash, wallet, nonce, deadline, signature, chainId, registry, verifier }` |

Errors are JSON `{ error, message, details? }`: `invalid_domain`, `invalid_wallet` (400), `txt_record_missing` (422, with the records seen), `rate_limited` (429 with `Retry-After`), `body_too_large` (413).

## Environment

See `.env.example`. `VERIFIER_PRIVATE_KEY` must correspond to the registry's current `verifier()`, which the Safe sets with `setVerifier`. Rotating the key is: deploy the service with the new key, then have the Safe call `setVerifier(newAddress)`; attestations signed by the old key stop working at once.

Rate limiting is per client IP, `RATE_LIMIT_PER_MINUTE` requests per minute, in memory. Behind a reverse proxy set `TRUST_PROXY=1` so the `X-Forwarded-For` address is used. `DNS_SERVERS` can point the TXT lookup at public resolvers so a local Sinkhole never interferes.

## Run

```sh
pnpm install
pnpm --filter @payhole/sdk build
cp .env.example .env    # fill in the key and registry address
pnpm dev                # tsx src/main.ts
pnpm build && pnpm start
```

Docker, from the repository root:

```sh
docker build -f packages/verifier/Dockerfile -t payhole-verifier .
docker run --env-file packages/verifier/.env -p 8787:8787 payhole-verifier
```

## Tests

```sh
pnpm test       # unit tests plus an anvil run that claims on a freshly deployed CreatorRegistry
pnpm typecheck
pnpm lint
```

The integration test deploys `CreatorRegistry` from the Foundry artifacts (`forge build` in `packages/contracts` first), attests with a fake DNS resolver, claims on-chain, proves the same attestation cannot be replayed, and rotates the wallet with a fresh attestation.
