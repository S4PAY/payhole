#!/usr/bin/env node
import { createPublicClient, erc20Abi, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { budgetAccountAbi, readSessionKey } from "../budget/index.js";
import { chainConfig, customChain, robinhoodChain, USDG_ADDRESS } from "../chain.js";
import { NoAcceptableOfferError, PayholeError, PaymentRefusedError, X402ProtocolError } from "../errors.js";
import { payholeFetch } from "../payholeFetch.js";
import { formatUsdg, parseUsdg } from "../usdg.js";
import { createX402Fetch, type PaymentOffer, type PaymentReceipt } from "../x402/index.js";
import { defaultKeyStorePath, KeyStore, type StoredKey } from "./keystore.js";

const USAGE = `payhole - pay x402 URLs from a PayHole pocket with capped session keys

Usage:
  payhole key create [--name <name>] --cap <usdg>    generate a session key with a local spending cap (name defaults to "default")
  payhole key import --name <name> --cap <usdg> <private-key>
  payhole key list                                   every key: name, address, spent / cap
  payhole key address [--key <name>]                 print a key's address (give it to the pocket owner)
  payhole key export --key <name>                    print a key's private key
  payhole status                                     pocket balance, every key's spend, sinkhole state
  payhole pay <url> [options]                        fetch a URL, paying its 402 if the caps allow
  payhole <url> [options]                            same as pay
      --key <name>                                   which stored key pays (default: the only key)
      --max <usdg>                                   refuse offers above this amount for this call, e.g. 0.05
      --method <GET|POST|...>                        HTTP method (default GET)
      --data <body>                                  request body
      --header <name:value>                          extra request header, repeatable
      --quiet                                        print only the response body

Environment:
  PAYHOLE_HOME             directory of the key file (default ~/.payhole, file keys.json, mode 600)
  PAYHOLE_BUDGET_ACCOUNT   pocket (BudgetAccount) the keys were issued on; without it keys pay from their own USDG balance
  PAYHOLE_SESSION_KEY      private key to use instead of the stored keys (no local cap)
  PAYHOLE_RPC_URL          RPC endpoint (default: the official Robinhood Chain RPC)
  PAYHOLE_CHAIN_ID         chain id (default 4663)
  PAYHOLE_USDG             USDG address override (tests only)
  SINKHOLE_ADMIN_URL       Sinkhole admin API for the status line (default http://127.0.0.1:8053)

Exit codes: 0 success, 1 error, 2 payment refused (cap, policy, or key not live), 3 no acceptable offer.
`;

interface Settings {
  rpcUrl: string;
  chainId: number;
  usdg: Address;
  budgetAccount: Address | undefined;
  sessionKey: Hex | undefined;
  store: KeyStore;
  sinkholeUrl: string;
}

function settings(): Settings {
  const budgetAccount = process.env["PAYHOLE_BUDGET_ACCOUNT"] ?? process.env["PAYHOLE_ACCOUNT"];
  const usdg = process.env["PAYHOLE_USDG"];
  if (budgetAccount && !isAddress(budgetAccount)) fail("PAYHOLE_BUDGET_ACCOUNT is not an address");
  if (usdg && !isAddress(usdg)) fail("PAYHOLE_USDG is not an address");
  const sessionKey = process.env["PAYHOLE_SESSION_KEY"];
  return {
    rpcUrl: process.env["PAYHOLE_RPC_URL"] ?? chainConfig.rpc,
    chainId: Number(process.env["PAYHOLE_CHAIN_ID"] ?? chainConfig.chainId),
    usdg: (usdg as Address | undefined) ?? USDG_ADDRESS,
    budgetAccount: budgetAccount as Address | undefined,
    sessionKey: sessionKey ? normalizeKey(sessionKey) : undefined,
    store: new KeyStore(defaultKeyStorePath()),
    sinkholeUrl: process.env["SINKHOLE_ADMIN_URL"] ?? "http://127.0.0.1:8053",
  };
}

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function normalizeKey(value: string): Hex {
  const key = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("private key must be 32 bytes of hex");
  return key as Hex;
}

/** `0x9c1e…4a2f`, the way addresses appear in the extension. */
function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Left column of every line the CLI prints, padded so values line up. */
function row(label: string, value: string): string {
  return `${label.padEnd(8)} ${value}`;
}

function amount(value: bigint): string {
  return `${formatUsdg(value)} USDG`;
}

function clients(s: Settings) {
  const chain = s.chainId === chainConfig.chainId && !process.env["PAYHOLE_RPC_URL"] ? robinhoodChain : customChain(s.chainId, s.rpcUrl);
  return { chain, publicClient: createPublicClient({ chain, transport: http(s.rpcUrl) }) };
}

interface Flags {
  values: Record<string, string>;
  headers: string[];
  quiet: boolean;
  positional: string[];
}

const VALUE_FLAGS = new Set(["--name", "--cap", "--key", "--max", "--method", "--data"]);

function parseFlags(args: string[]): Flags {
  const out: Flags = { values: {}, headers: [], quiet: false, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const next = (): string => {
      const v = args[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    if (VALUE_FLAGS.has(arg)) out.values[arg.slice(2)] = next();
    else if (arg === "--header") out.headers.push(next());
    else if (arg === "--quiet") out.quiet = true;
    else if (arg.startsWith("--")) fail(`unknown option ${arg}`);
    else out.positional.push(arg);
  }
  return out;
}

function capFlag(flags: Flags, usage: string): bigint {
  const raw = flags.values["cap"];
  if (raw === undefined) fail(usage);
  const cap = parseUsdg(raw);
  if (cap <= 0n) fail("--cap must be more than zero");
  return cap;
}

/** Which key a command works with: --key from the store, else PAYHOLE_SESSION_KEY, else the only stored key. */
function chooseKey(s: Settings, flags: Flags): { privateKey: Hex; stored: StoredKey | undefined } {
  const name = flags.values["key"];
  if (name !== undefined) {
    const stored = s.store.get(name);
    if (!stored) fail(`no key named "${name}" in ${s.store.path}; run "payhole key list"`);
    return { privateKey: stored.privateKey, stored };
  }
  if (s.sessionKey) return { privateKey: s.sessionKey, stored: undefined };
  const keys = s.store.list();
  const [only] = keys;
  if (keys.length === 1 && only) return { privateKey: only.privateKey, stored: only };
  if (keys.length === 0) fail(`no session key: run "payhole key create --cap <usdg>" or set PAYHOLE_SESSION_KEY (looked in ${s.store.path})`);
  return fail(`several keys in ${s.store.path}; choose one with --key <name>`);
}

function commandKey(s: Settings, args: string[]): void {
  const [sub, ...rest] = args;
  const flags = parseFlags(rest);
  switch (sub) {
    case "create": {
      const name = flags.values["name"] ?? "default";
      const key = s.store.create(name, capFlag(flags, "usage: payhole key create [--name <name>] --cap <usdg>"));
      process.stdout.write(`${row("created", `${short(key.address)}  cap ${amount(key.cap)}`)}\n`);
      return;
    }
    case "import": {
      const name = flags.values["name"];
      const [raw] = flags.positional;
      if (name === undefined || raw === undefined) fail("usage: payhole key import --name <name> --cap <usdg> <private-key>");
      const key = s.store.create(name, capFlag(flags, "usage: payhole key import --name <name> --cap <usdg> <private-key>"), normalizeKey(raw));
      process.stdout.write(`${row("imported", `${short(key.address)}  cap ${amount(key.cap)}`)}\n`);
      return;
    }
    case "list": {
      const keys = s.store.list();
      if (keys.length === 0) {
        process.stdout.write(`no keys in ${s.store.path}\n`);
        return;
      }
      const width = Math.max(...keys.map((k) => k.name.length));
      for (const k of keys) process.stdout.write(`${k.name.padEnd(width)}  ${short(k.address)}  ${formatUsdg(k.spent)} / ${formatUsdg(k.cap)}\n`);
      return;
    }
    case "address":
      process.stdout.write(`${privateKeyToAccount(chooseKey(s, flags).privateKey).address}\n`);
      return;
    case "export": {
      if (flags.values["key"] === undefined) fail("usage: payhole key export --key <name>");
      process.stdout.write(`${chooseKey(s, flags).privateKey}\n`);
      return;
    }
    case undefined:
    default:
      fail(USAGE);
  }
}

/** `on` when the local Sinkhole admin API answers its health check within half a second. */
async function sinkholeState(url: string): Promise<"on" | "off"> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/healthz`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return "off";
    const body = (await response.json()) as { ok?: unknown };
    return body.ok === true ? "on" : "off";
  } catch {
    return "off";
  }
}

async function commandStatus(s: Settings): Promise<void> {
  const { publicClient } = clients(s);
  const keys = s.store.list();
  const lines: string[] = [];

  if (s.budgetAccount) {
    const account = s.budgetAccount;
    const [balance, cap, spent] = await Promise.all([
      publicClient.readContract({ address: s.usdg, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      publicClient.readContract({ address: account, abi: budgetAccountAbi, functionName: "globalCap" }),
      publicClient.readContract({ address: account, abi: budgetAccountAbi, functionName: "globalSpent" }),
    ]);
    lines.push(row("pocket", `${amount(balance)}  cap ${formatUsdg(cap)}  spent ${formatUsdg(spent)}  ${short(account)}`));
  } else {
    const payer = s.sessionKey ? privateKeyToAccount(s.sessionKey).address : keys[0]?.address;
    if (payer) {
      const balance = await publicClient.readContract({ address: s.usdg, abi: erc20Abi, functionName: "balanceOf", args: [payer] });
      lines.push(row("pocket", `${amount(balance)}  direct from ${short(payer)}, no budget account`));
    } else {
      lines.push(row("pocket", "none: set PAYHOLE_BUDGET_ACCOUNT or create a key"));
    }
  }

  if (keys.length === 0) {
    lines.push(row("keys", "none"));
  } else {
    const width = Math.max(...keys.map((k) => k.name.length));
    const account = s.budgetAccount;
    const chainState = account ? await Promise.all(keys.map((k) => readSessionKey(publicClient, account, k.address))) : keys.map(() => undefined);
    keys.forEach((k, i) => {
      const state = chainState[i];
      const onChain = state ? `  ${state.live ? "live" : "not live"} on chain, ${formatUsdg(state.remaining)} left` : "";
      lines.push(row(i === 0 ? "keys" : "", `${k.name.padEnd(width)}  ${formatUsdg(k.spent)} / ${formatUsdg(k.cap)}${onChain}`));
    });
  }

  lines.push(row("sinkhole", await sinkholeState(s.sinkholeUrl)));
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function commandPay(s: Settings, args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const [url, extra] = flags.positional;
  if (url === undefined) fail("usage: payhole pay <url> [--key <name>] [--max <usdg>] [--method M] [--data body] [--header n:v] [--quiet]");
  if (extra !== undefined) fail(`unexpected argument ${extra}`);
  const headers: Record<string, string> = {};
  for (const raw of flags.headers) {
    const idx = raw.indexOf(":");
    if (idx <= 0) fail("--header expects name:value");
    headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }
  const maxRaw = flags.values["max"];
  const max = maxRaw !== undefined ? parseUsdg(maxRaw) : undefined;
  const method = (flags.values["method"] ?? "GET").toUpperCase();
  const data = flags.values["data"];

  const log = (line: string) => {
    if (!flags.quiet) process.stderr.write(`${line}\n`);
  };
  const { privateKey, stored } = chooseKey(s, flags);
  const account = privateKeyToAccount(privateKey);

  // The local cap is checked before anything is signed or pulled; the chain checks its own cap after.
  const localCap = (offer: PaymentOffer) => {
    if (stored && stored.spent + offer.amount > stored.cap) {
      throw new PaymentRefusedError(
        `key "${stored.name}" can spend ${formatUsdg(stored.cap - stored.spent)} USDG more, needs ${formatUsdg(offer.amount)} USDG`,
        "cap-exceeded",
        offer.amount,
      );
    }
    return { allow: true as const };
  };
  const onPaid = (receipt: PaymentReceipt) => {
    const settled = receipt.settlement ? receipt.settlement.success : receipt.status < 400;
    if (settled) {
      if (stored) s.store.recordSpend(stored.name, receipt.offer.amount);
      const tx = receipt.settlement?.transaction;
      log(row("paid", `${amount(receipt.offer.amount)}${tx ? `  tx ${short(tx)}` : ""}`));
    } else {
      log(row("failed", `settlement: ${receipt.settlement?.errorReason ?? `status ${receipt.status}`}`));
    }
  };

  let fetchPaid: typeof globalThis.fetch;
  if (s.budgetAccount) {
    fetchPaid = payholeFetch({
      sessionKey: privateKey,
      budgetAccount: s.budgetAccount,
      rpcUrl: s.rpcUrl,
      chainId: s.chainId,
      usdg: s.usdg,
      ...(max !== undefined ? { maxAmount: max } : {}),
      authorize: localCap,
      onPull: (pulled, txHash) => log(row("pulled", `${amount(pulled)} from the pocket${txHash ? `  tx ${short(txHash)}` : ""}`)),
      onPaid,
    });
  } else {
    // No pocket configured: pay from the key's own USDG balance. Used for facilitator interop checks.
    log(row("direct", `paying from ${short(account.address)}, no budget account set`));
    fetchPaid = createX402Fetch({
      signer: account,
      chainId: s.chainId,
      asset: s.usdg,
      authorize: (offer) => {
        if (max !== undefined && offer.amount > max) {
          throw new PaymentRefusedError(`offer of ${amount(offer.amount)} exceeds --max ${amount(max)}`, "max-exceeded", offer.amount);
        }
        return localCap(offer);
      },
      onPaid,
    });
  }
  try {
    const response = await fetchPaid(url, { method, headers, ...(data !== undefined ? { body: data } : {}) });
    const body = await response.text();
    log(row("status", `${response.status} ${response.statusText}`.trim()));
    process.stdout.write(body.endsWith("\n") || body.length === 0 ? body : `${body}\n`);
    process.exitCode = response.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof PaymentRefusedError) fail(`payment refused (${error.reason}): ${error.message}`, 2);
    if (error instanceof NoAcceptableOfferError) fail(`no acceptable offer: ${error.reasons.join("; ")}`, 3);
    if (error instanceof X402ProtocolError) fail(`malformed x402 response: ${error.message}`);
    throw error;
  }
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "key":
      return commandKey(settings(), rest);
    case "status":
      return commandStatus(settings());
    case "pay":
      return commandPay(settings(), rest);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      if (/^https?:\/\//.test(command)) return commandPay(settings(), argv);
      fail(USAGE);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  fail(error instanceof PayholeError ? error.message : error instanceof Error ? error.message : String(error));
});
