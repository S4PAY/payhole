#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createPublicClient, erc20Abi, formatUnits, http, isAddress, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { budgetAccountAbi, readSessionKey } from "../budget/index.js";
import { chainConfig, customChain, robinhoodChain, USDG_ADDRESS, USDG_DECIMALS } from "../chain.js";
import { NoAcceptableOfferError, PaymentRefusedError, X402ProtocolError } from "../errors.js";
import { payholeFetch } from "../payholeFetch.js";
import { createX402Fetch, type PaymentReceipt } from "../x402/index.js";

const USAGE = `payhole - pay x402 URLs from a BudgetAccount with a session key

Usage:
  payhole key create                 generate a session key and store it in the key file
  payhole key import <private-key>   store an existing session key
  payhole key address                print the session key address (give this to the account owner)
  payhole key export                 print the private key
  payhole status                     show the key's cap, spend, and balances on the BudgetAccount
  payhole pay <url> [options]        fetch a URL, paying a 402 if the key's cap allows it
      --method <GET|POST|...>        HTTP method (default GET)
      --data <body>                  request body
      --header <name:value>          extra request header, repeatable
      --max <usdg>                   refuse offers above this amount, e.g. 0.05
      --quiet                        print only the response body

Environment:
  PAYHOLE_BUDGET_ACCOUNT   BudgetAccount address the key was issued on (required for status and pay)
  PAYHOLE_KEY_FILE         key file path (default ~/.payhole/session-key.json)
  PAYHOLE_SESSION_KEY      private key, overrides the key file
  PAYHOLE_RPC_URL          RPC endpoint (default: the official Robinhood Chain RPC)
  PAYHOLE_CHAIN_ID         chain id (default 4663)
  PAYHOLE_USDG             USDG address override (tests only)

Exit codes: 0 success, 1 error, 2 payment refused (cap, policy, or key not live), 3 no acceptable offer.
`;

interface Settings {
  rpcUrl: string;
  chainId: number;
  usdg: Address;
  budgetAccount: Address | undefined;
  keyFile: string;
  sessionKey: Hex | undefined;
}

function settings(): Settings {
  const chainId = Number(process.env["PAYHOLE_CHAIN_ID"] ?? chainConfig.chainId);
  const budgetAccount = process.env["PAYHOLE_BUDGET_ACCOUNT"];
  const usdg = process.env["PAYHOLE_USDG"];
  if (budgetAccount && !isAddress(budgetAccount)) fail("PAYHOLE_BUDGET_ACCOUNT is not an address");
  if (usdg && !isAddress(usdg)) fail("PAYHOLE_USDG is not an address");
  const sessionKey = process.env["PAYHOLE_SESSION_KEY"];
  return {
    rpcUrl: process.env["PAYHOLE_RPC_URL"] ?? chainConfig.rpc,
    chainId,
    usdg: (usdg as Address | undefined) ?? USDG_ADDRESS,
    budgetAccount: budgetAccount as Address | undefined,
    keyFile: process.env["PAYHOLE_KEY_FILE"] ?? join(homedir(), ".payhole", "session-key.json"),
    sessionKey: sessionKey ? normalizeKey(sessionKey) : undefined,
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

function loadKey(s: Settings): Hex {
  if (s.sessionKey) return s.sessionKey;
  if (!existsSync(s.keyFile)) fail(`no session key: run "payhole key create" or set PAYHOLE_SESSION_KEY (looked in ${s.keyFile})`);
  const parsed = JSON.parse(readFileSync(s.keyFile, "utf8")) as { privateKey?: string };
  if (!parsed.privateKey) fail(`key file ${s.keyFile} has no privateKey field`);
  return normalizeKey(parsed.privateKey);
}

function saveKey(s: Settings, privateKey: Hex): Address {
  const account = privateKeyToAccount(privateKey);
  mkdirSync(dirname(s.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(
    s.keyFile,
    JSON.stringify({ privateKey, address: account.address, createdAt: new Date().toISOString() }, null, 2) + "\n",
    { mode: 0o600 },
  );
  chmodSync(s.keyFile, 0o600);
  return account.address;
}

function usdgText(amount: bigint): string {
  return `${formatUnits(amount, USDG_DECIMALS)} USDG`;
}

function clients(s: Settings) {
  const chain = s.chainId === chainConfig.chainId && !process.env["PAYHOLE_RPC_URL"] ? robinhoodChain : customChain(s.chainId, s.rpcUrl);
  return { chain, publicClient: createPublicClient({ chain, transport: http(s.rpcUrl) }) };
}

function commandKey(s: Settings, args: string[]): void {
  const [sub, value] = args;
  switch (sub) {
    case "create": {
      if (existsSync(s.keyFile)) fail(`refusing to overwrite ${s.keyFile}; move it first`);
      const address = saveKey(s, generatePrivateKey());
      process.stdout.write(`created session key ${address}\nstored in ${s.keyFile}\n`);
      return;
    }
    case "import": {
      if (!value) fail("usage: payhole key import <private-key>");
      if (existsSync(s.keyFile)) fail(`refusing to overwrite ${s.keyFile}; move it first`);
      const address = saveKey(s, normalizeKey(value));
      process.stdout.write(`imported session key ${address}\nstored in ${s.keyFile}\n`);
      return;
    }
    case "address":
      process.stdout.write(`${privateKeyToAccount(loadKey(s)).address}\n`);
      return;
    case "export":
      process.stdout.write(`${loadKey(s)}\n`);
      return;
    case undefined:
    default:
      fail(USAGE);
  }
}

async function commandStatus(s: Settings): Promise<void> {
  if (!s.budgetAccount) fail("set PAYHOLE_BUDGET_ACCOUNT");
  const key = privateKeyToAccount(loadKey(s)).address;
  const { publicClient } = clients(s);
  const [state, keyUsdg, keyEth, accountUsdg, globalCap, globalSpent, owner] = await Promise.all([
    readSessionKey(publicClient, s.budgetAccount, key),
    publicClient.readContract({ address: s.usdg, abi: erc20Abi, functionName: "balanceOf", args: [key] }),
    publicClient.getBalance({ address: key }),
    publicClient.readContract({ address: s.usdg, abi: erc20Abi, functionName: "balanceOf", args: [s.budgetAccount] }),
    publicClient.readContract({ address: s.budgetAccount, abi: budgetAccountAbi, functionName: "globalCap" }),
    publicClient.readContract({ address: s.budgetAccount, abi: budgetAccountAbi, functionName: "globalSpent" }),
    publicClient.readContract({ address: s.budgetAccount, abi: budgetAccountAbi, functionName: "owner" }),
  ]);
  const expiry = state.expiry === 0 ? "-" : new Date(state.expiry * 1000).toISOString();
  process.stdout.write(
    [
      `budget account   ${s.budgetAccount} (owner ${owner})`,
      `account balance  ${usdgText(accountUsdg)}`,
      `global cap       ${usdgText(globalSpent)} spent of ${usdgText(globalCap)}`,
      `session key      ${key}`,
      `key status       ${state.live ? "live" : "not live"} (epoch ${state.epoch}, expires ${expiry})`,
      `key cap          ${usdgText(state.spent)} spent of ${usdgText(state.cap)}`,
      `remaining        ${usdgText(state.remaining)}`,
      `key balances     ${usdgText(keyUsdg)}, ${formatUnits(keyEth, 18)} ETH for gas`,
      "",
    ].join("\n"),
  );
}

interface PayArgs {
  url: string;
  method: string;
  data: string | undefined;
  headers: Record<string, string>;
  max: bigint | undefined;
  quiet: boolean;
}

function parsePayArgs(args: string[]): PayArgs {
  const out: PayArgs = { url: "", method: "GET", data: undefined, headers: {}, max: undefined, quiet: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const next = (): string => {
      const v = args[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    if (arg === "--method") out.method = next().toUpperCase();
    else if (arg === "--data") out.data = next();
    else if (arg === "--max") out.max = parseUnits(next(), USDG_DECIMALS);
    else if (arg === "--quiet") out.quiet = true;
    else if (arg === "--header") {
      const raw = next();
      const idx = raw.indexOf(":");
      if (idx <= 0) fail("--header expects name:value");
      out.headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
    } else if (arg.startsWith("--")) fail(`unknown option ${arg}`);
    else if (!out.url) out.url = arg;
    else fail(`unexpected argument ${arg}`);
  }
  if (!out.url) fail("usage: payhole pay <url> [options]");
  return out;
}

async function commandPay(s: Settings, args: string[]): Promise<void> {
  const pay = parsePayArgs(args);
  const log = (line: string) => {
    if (!pay.quiet) process.stderr.write(`${line}\n`);
  };
  const onPaid = (receipt: PaymentReceipt) => {
    log(`paid ${usdgText(receipt.offer.amount)} to ${receipt.offer.payTo} (x402 v${receipt.offer.version})`);
    if (receipt.settlement) {
      log(
        receipt.settlement.success
          ? `settled in ${receipt.settlement.transaction}`
          : `settlement failed: ${receipt.settlement.errorReason ?? "unknown"}`,
      );
    }
  };
  const account = privateKeyToAccount(loadKey(s));
  let fetchPaid: typeof globalThis.fetch;
  if (s.budgetAccount) {
    fetchPaid = payholeFetch({
      sessionKey: loadKey(s),
      budgetAccount: s.budgetAccount,
      rpcUrl: s.rpcUrl,
      chainId: s.chainId,
      usdg: s.usdg,
      ...(pay.max !== undefined ? { maxAmount: pay.max } : {}),
      onPull: (pulled, txHash) => log(`pulled ${usdgText(pulled)} from the budget account (${txHash ?? "no tx"})`),
      onPaid,
    });
  } else {
    // No BudgetAccount configured: pay from the key's own USDG balance. Used for facilitator interop checks.
    log("PAYHOLE_BUDGET_ACCOUNT not set: paying from the key's own balance");
    fetchPaid = createX402Fetch({
      signer: account,
      chainId: s.chainId,
      asset: s.usdg,
      authorize: (offer) =>
        pay.max !== undefined && offer.amount > pay.max
          ? { allow: false, reason: `amount ${offer.amount.toString()} exceeds the configured maximum` }
          : { allow: true },
      onPaid,
    });
  }
  log(`payer ${account.address}`);
  try {
    const response = await fetchPaid(pay.url, {
      method: pay.method,
      headers: pay.headers,
      ...(pay.data !== undefined ? { body: pay.data } : {}),
    });
    const body = await response.text();
    log(`${response.status} ${response.statusText}`.trim());
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
  const s = settings();
  switch (command) {
    case "key":
      return commandKey(s, rest);
    case "status":
      return commandStatus(s);
    case "pay":
      return commandPay(s, rest);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      fail(USAGE);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
