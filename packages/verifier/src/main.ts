import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDG_ADDRESS, customChain, readClaimNonce, robinhoodChain } from "@payhole/sdk";
import { attest } from "./attest.js";
import { loadConfig } from "./config.js";
import { systemResolver } from "./dns.js";
import { RateLimiter } from "./rateLimit.js";
import { createServer } from "./server.js";

const config = loadConfig();
const signer = privateKeyToAccount(config.verifierKey);
const chain = config.chainId === robinhoodChain.id && !process.env["RPC_URL"] ? robinhoodChain : customChain(config.chainId, config.rpcUrl);
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const server = createServer({
  attest: (input) =>
    attest(
      {
        resolveTxt: systemResolver(config.dnsServers),
        readNonce: (hash: Hex) => readClaimNonce(publicClient, config.registry, hash),
        signer,
        chainId: config.chainId,
        registry: config.registry,
        ttlSeconds: config.attestationTtlSeconds,
      },
      input,
    ),
  limiter: new RateLimiter(config.rateLimitPerMinute, 60_000),
  trustProxy: config.trustProxy,
  health: () => ({
    verifier: signer.address,
    registry: config.registry,
    chainId: config.chainId,
    demo: config.demo ? { price: config.demo.price.toString(), payTo: config.demo.payTo, facilitators: config.demo.facilitators } : null,
  }),
  ...(config.demo ? { demo: { config: { ...config.demo, asset: USDG_ADDRESS, network: `eip155:${config.chainId}` } } } : {}),
});

server.listen(config.port, config.host, () => {
  console.log(`payhole verifier ${signer.address} for registry ${config.registry} on chain ${config.chainId}, listening on ${config.host}:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
