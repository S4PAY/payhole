import { recoverTypedDataAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { claimTypedData, domainHash } from "@payhole/sdk";
import { attest, AttestError, type AttestDeps } from "../src/attest.js";
import { findWalletInTxt } from "../src/dns.js";

const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const registry: Address = "0x1000000000000000000000000000000000000001";
const wallet: Address = "0xb9A67f59bcfd3b45fe1ca2c55A55C19B2b35B58f";

function deps(records: Record<string, string[][]>, nonce = 0n): AttestDeps {
  return {
    resolveTxt: (name) => Promise.resolve(records[name] ?? []),
    readNonce: () => Promise.resolve(nonce),
    signer,
    chainId: 4663,
    registry,
    ttlSeconds: 3600,
    now: () => 1_800_000_000,
  };
}

describe("findWalletInTxt", () => {
  it("accepts payhole=, wallet=, and bare forms, joining chunks", () => {
    expect(findWalletInTxt([["payhole=", wallet.toLowerCase()]], wallet).found).toBe(true);
    expect(findWalletInTxt([[`wallet=${wallet}`]], wallet).found).toBe(true);
    expect(findWalletInTxt([["v=spf1 -all"], [wallet]], wallet).found).toBe(true);
    expect(findWalletInTxt([[`PAYHOLE=${wallet.toUpperCase().replace("0X", "0x")}`]], wallet).found).toBe(true);
  });

  it("does not match other wallets or junk", () => {
    const other = findWalletInTxt([["payhole=0x1000000000000000000000000000000000000001"]], wallet);
    expect(other.found).toBe(false);
    expect(other.wallets).toEqual(["0x1000000000000000000000000000000000000001"]);
    expect(findWalletInTxt([["payhole=0x123"]], wallet).found).toBe(false);
    expect(findWalletInTxt([], wallet)).toEqual({ found: false, wallets: [], seen: [] });
  });
});

describe("attest", () => {
  it("signs a claim the registry will accept", async () => {
    const result = await attest(deps({ "_payhole.example.com": [[`payhole=${wallet}`]] }, 3n), { domain: "https://Example.com/path", wallet: wallet.toLowerCase() });
    expect(result.domain).toBe("example.com");
    expect(result.domainHash).toBe(domainHash("example.com"));
    expect(result.wallet).toBe(wallet);
    expect(result.nonce).toBe("3");
    expect(result.deadline).toBe(String(1_800_000_000 + 3600));
    expect(result.verifier).toBe(signer.address);
    const typed = claimTypedData(4663, registry, { domainHash: result.domainHash, wallet, nonce: 3n, deadline: 1_800_003_600n });
    expect(await recoverTypedDataAddress({ ...typed, signature: result.signature })).toBe(signer.address);
  });

  it("rejects a domain whose TXT record names another wallet", async () => {
    const d = deps({ "_payhole.example.com": [["payhole=0x1000000000000000000000000000000000000001"]] });
    const error = await attest(d, { domain: "example.com", wallet }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AttestError);
    expect((error as AttestError).status).toBe(422);
    expect((error as AttestError).code).toBe("txt_record_missing");
    expect((error as AttestError).details).toMatchObject({ name: "_payhole.example.com" });
  });

  it("rejects missing records and bad input", async () => {
    await expect(attest(deps({}), { domain: "example.com", wallet })).rejects.toMatchObject({ status: 422 });
    await expect(attest(deps({}), { domain: "example.com", wallet: "0x12" })).rejects.toMatchObject({ status: 400, code: "invalid_wallet" });
    await expect(attest(deps({}), { domain: "localhost", wallet })).rejects.toMatchObject({ status: 400, code: "invalid_domain" });
    await expect(attest(deps({}), { domain: "_payhole.example.com", wallet })).rejects.toMatchObject({ status: 400, code: "invalid_domain" });
    await expect(attest(deps({}), { domain: 42, wallet })).rejects.toMatchObject({ status: 400 });
  });
});
