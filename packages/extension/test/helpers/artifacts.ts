import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi, Hex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "..", "contracts", "out");

/** Reads a Foundry artifact from packages/contracts/out (run `forge build` there first). */
export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const direct = join(out, `${name}.sol`, `${name}.json`);
  const path = existsSync(direct)
    ? direct
    : readdirSync(out)
        .map((dir) => join(out, dir, `${name}.json`))
        .find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`artifact ${name} not found under ${out}; run "forge build" in packages/contracts`);
  const json = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export const mockUsdgAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
