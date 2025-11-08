# PayHole

“The web should pay you peace, not steal your data.”

## Vision
PayHole is a decentralized, privacy-first ad-blocking and micropayment protocol built on Solana. We intercept intrusive ads and trackers at the network and proxy layers, enforce the `x402` payment standard for premium content, and let users compensate creators directly with USDC—without surrendering privacy.

## Core Principles
- Speed: low-latency interception and Solana-first settlement flows.
- Privacy: encrypted DNS, zero third-party tracking, local-first analytics.
- Ownership: users control their data, creators receive direct tips, and infrastructure remains open.

## Architecture Overview
The system is organized into modular surfaces that can evolve independently while sharing common tooling and governance.

- `edge/`: DNS sinkhole with DoH support, curated blocklists, and local telemetry sinks.
- `proxy/`: High-performance Rust/Go HTTP proxy that applies dynamic x402 rules and delegates to the AI content classifier.
- `payments/`: Node.js (or Deno) services for Solana USDC settlement, signature verification, and JWT-based session issuance.
- `dashboard/`: Next.js dashboard for wallet connect, analytics, and rule orchestration.
- `ai/`: Local-first classifier and policy engine to decide between blocking, allowing, or paywalling content.
- `infra/`: Docker images, CI/CD workflows, Anycast deployment manifests, and shared tooling scripts.

## Repository Layout
```
.
├── ai/
├── dashboard/
├── edge/
├── infra/
├── payments/
├── proxy/
└── README.md
```

Each module will ship with dedicated documentation, tests (unit + integration), and clearly defined interfaces. Shared configuration, linting, and security policies will be centralized as the codebase matures.

## Getting Started
1. Clone the repository and install workspace prerequisites (`Node.js`, `Go`, Docker, Solana CLI, and a wallet adapter for local testing).
2. Bootstrap internal tooling:
   - Configure environment variables via a local `.env` file (see `infra/README.md` for a template; never commit secrets).
   - Provision Solana devnet accounts for USDC testing.
3. Start the full stack with Docker Compose:

   ```bash
   cp infra/README.md .env   # copy template and edit secrets
   docker compose up --build
   ```

4. Follow module-specific READMEs for build, test, and deployment workflows.

## Containerisation & DevOps
- Production-ready Dockerfiles live alongside each service (`dashboard`, `payments`, `proxy`).
- `docker-compose.yml` orchestrates the stack with a shared bridge network and restart policies.
- `.github/workflows/ci.yml` runs tests on pull requests and builds/pushes GHCR images on merges to `main`.
- Reference staging manifests for DigitalOcean, Fly.io, and Railway are available under `infra/staging/`.

## Next Steps
- Flesh out module scaffolding with linting, formatting, and test harnesses.
- Define shared protobuf/JSON schemas for policy decisions and payment proofs.
- Implement CI gates in `infra/` to run formatters, tests, and security scans before merge.
- Document contribution guidelines covering privacy, logging, and review expectations.

---

PayHole is committed to a future where browsing is peaceful, private, and creator-supportive.

