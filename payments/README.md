# PayHole Payments Service

Node.js (TypeScript) backend that validates Solana USDC payments through Helius RPC, issues 30-day JWT unlock tokens, and tracks unlock records in a lightweight file database.

## Getting Started

```bash
npm install
npm run dev
```

The dev server listens on `http://localhost:4000` by default. REST endpoints:

- `POST /pay` – Body `{ wallet, signature }`; verifies USDC settlement, records unlock, returns `{ token, expiresAt, wallet }`.
- `GET /status` – Requires `Authorization: Bearer <token>` header; validates token and responds with `{ wallet, expiresAt, remainingDays }`.

### Environment Variables

Set the following variables (e.g. via `.env.local`, not committed):

- `HELIUS_RPC_URL` – Helius RPC endpoint for Solana `getTransaction` calls.
- `JWT_SECRET` – Secret string (≥32 characters) used to sign unlock JWTs.
- `UNLOCK_DB_PATH` – Optional path for the JSON file store (`data/unlocks.json` default).
- `USDC_MINT_ADDRESS` – Optional override for the USDC SPL mint (defaults to mainnet USDC).
- `PORT` – Optional server port (default `4000`).

### Production Build

```bash
npm run build
npm start
```

`npm run build` compiles into `dist/`; `npm start` runs the compiled server.

## Testing

```bash
npm test
```

The suite covers:

- Solana transaction verification logic (mocked Helius responses).
- JWT issuance and expiry calculations.
- Unlock record persistence lifecycle.
- Integration flow across `/pay` and `/status` endpoints.

## Future Enhancements

- Swap the JSON file store for SQLite with expiry pruning and audit logging.
- Add rate limiting and signature replay protection per wallet.
- Expand verification to assert USDC transfer amounts and merchant recipients.

