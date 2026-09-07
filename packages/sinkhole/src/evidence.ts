import { promises as dns } from "node:dns";
import { brandsOf } from "./radar.js";

/**
 * Evidence about a reported name, gathered by the node so a tier holder can confirm in one look and the
 * owner can pay a bounty with reasons attached. Every probe is bounded in time and size, and the whole
 * thing is off unless EVIDENCE_ENABLED is set, because a home node should not fetch scam pages by default.
 */

export interface Evidence {
  checkedAt: number;
  /** 0 to 100; the marks say why. */
  score: number;
  marks: string[];
  resolves: boolean;
  brands: string[];
  freeHosting: string | null;
  /** Days since the domain was registered, from the public registry record; null when unknown. */
  ageDays: number | null;
  /** Days since the newest certificate was logged; null when unknown. */
  certDays: number | null;
  page: { status: number; title: string | null } | null;
}

/** What the probes saw, before scoring; scoring is pure so it can be tested without the network. */
export interface Observation {
  domain: string;
  resolves: boolean;
  html: string | null;
  status: number | null;
  ageDays: number | null;
  certDays: number | null;
  now: number;
}

const FREE_HOSTING = [
  "pages.dev",
  "workers.dev",
  "r2.dev",
  "netlify.app",
  "vercel.app",
  "web.app",
  "firebaseapp.com",
  "github.io",
  "gitlab.io",
  "glitch.me",
  "repl.co",
  "weebly.com",
  "wixsite.com",
  "webflow.io",
  "framer.website",
  "carrd.co",
  "godaddysites.com",
  "blogspot.com",
  "wordpress.com",
  "square.site",
  "ipfs.io",
  "ipfs.dweb.link",
  "surge.sh",
  "onrender.com",
  "fly.dev",
  "herokuapp.com",
];

const SEED_PHRASE = /secret recovery phrase|seed phrase|recovery phrase|mnemonic|12[- ]word|24[- ]word|private key/i;
const WALLET_CONNECT = /eth_requestaccounts|walletconnect|web3modal|rainbowkit|wagmi|@solana\/wallet-adapter|window\.ethereum|window\.solana|phantom\.solana/i;
const CLAIM_WORDS = /airdrop|claim (your|now|reward)|eligib|mint now|connect wallet|migration|revoke|whitelist|allocation|redeem/i;
const APPROVALS = /setapprovalforall|permit2|increaseallowance|approve\(|signtypeddata|eth_sign\b|transferfrom|safebatchtransferfrom/i;
const LOGIN = /password|log ?in|sign ?in|verify your (account|identity|wallet)|unlock your wallet|import wallet|restore wallet/i;
const OBFUSCATED = /eval\(|atob\(|\\x[0-9a-f]{2}\\x[0-9a-f]{2}|fromcharcode|unescape\(/gi;

function freeHostingOf(domain: string): string | null {
  return FREE_HOSTING.find((suffix) => domain === suffix || domain.endsWith(`.${suffix}`)) ?? null;
}

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html);
  return match?.[1] ? match[1].trim() : null;
}

/** Turns what the probes saw into a score and a list of marks a person can read. */
export function scoreEvidence(observation: Observation): Evidence {
  const marks: string[] = [];
  let score = 0;
  const brands = brandsOf(observation.domain);
  if (brands.length > 0) {
    score += 25;
    marks.push(`name trades on ${brands.join(", ")}`);
  }
  const freeHosting = freeHostingOf(observation.domain);
  if (freeHosting) {
    score += 10;
    marks.push(`hosted on ${freeHosting}, a free platform`);
  }
  if (!observation.resolves) {
    score -= 20;
    marks.push("does not resolve right now");
  }
  if (observation.ageDays !== null && observation.ageDays <= 30) {
    score += 15;
    marks.push(observation.ageDays <= 1 ? "registered today" : `registered ${observation.ageDays} days ago`);
  }
  if (observation.certDays !== null && observation.certDays <= 7) {
    score += 5;
    marks.push("certificate issued this week");
  }
  let page: Evidence["page"] = null;
  if (observation.html !== null) {
    const html = observation.html;
    page = { status: observation.status ?? 200, title: titleOf(html) };
    const seed = SEED_PHRASE.test(html);
    const connect = WALLET_CONNECT.test(html);
    const claim = CLAIM_WORDS.test(html);
    const approvals = APPROVALS.test(html);
    const login = LOGIN.test(html);
    const obfuscated = (html.match(OBFUSCATED) ?? []).length;
    if (seed) {
      score += 35;
      marks.push("asks for a seed phrase or private key");
    }
    if (connect && claim) {
      score += 25;
      marks.push("wallet connection tied to a claim, airdrop, or mint");
    } else if (connect) {
      score += 10;
      marks.push("connects to a wallet");
    }
    if (approvals) {
      score += 15;
      marks.push("calls that move tokens on approval");
    }
    if (brands.length > 0 && login) {
      score += 20;
      marks.push("brand name with a login or verification form");
    }
    if (obfuscated >= 5) {
      score += 10;
      marks.push("heavily obfuscated script");
    }
  } else if (observation.status !== null) {
    page = { status: observation.status, title: null };
  }
  return {
    checkedAt: observation.now,
    score: Math.max(0, Math.min(100, score)),
    marks,
    resolves: observation.resolves,
    brands,
    freeHosting,
    ageDays: observation.ageDays,
    certDays: observation.certDays,
    page,
  };
}

export interface ProbeOptions {
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
  clock?: (() => number) | undefined;
  /** Fetch the page itself; off leaves the score to the name, registry, and certificate signals. */
  fetchPages?: boolean | undefined;
}

const UA = "PayHole Sinkhole evidence (https://payhole.org/sinkhole.html)";

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.byteLength;
    chunks.push(value);
    if (size >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8", 0, Math.min(size, maxBytes));
}

/** Runs every probe for a name and scores the result. Never throws; what fails is simply unknown. */
export async function gatherEvidence(domain: string, options: ProbeOptions = {}): Promise<Evidence> {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const now = (options.clock ?? Date.now)();
  const day = 24 * 60 * 60 * 1000;

  const resolves = (await withTimeout(timeoutMs, () => dns.resolve4(domain).then((records) => records.length > 0))) ?? false;

  const ageDays = await withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal, headers: { accept: "application/rdap+json", "user-agent": UA }, redirect: "follow" });
    if (!response.ok) return null;
    const body = (await response.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
    const registration = body.events?.find((event) => event.eventAction === "registration")?.eventDate;
    const at = registration ? Date.parse(registration) : Number.NaN;
    return Number.isNaN(at) ? null : Math.max(0, Math.floor((now - at) / day));
  });

  const certDays = await withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, { signal, headers: { accept: "application/json", "user-agent": UA } });
    if (!response.ok) return null;
    const body = (await response.json()) as { not_before?: string }[];
    let newest = Number.NEGATIVE_INFINITY;
    for (const entry of body) {
      const at = entry.not_before ? Date.parse(`${entry.not_before}Z`) : Number.NaN;
      if (!Number.isNaN(at) && at > newest) newest = at;
    }
    return Number.isFinite(newest) ? Math.max(0, Math.floor((now - newest) / day)) : null;
  });

  let html: string | null = null;
  let status: number | null = null;
  if (options.fetchPages !== false && resolves) {
    for (const scheme of ["https", "http"]) {
      const result = await withTimeout(timeoutMs, async (signal) => {
        const response = await fetchImpl(`${scheme}://${domain}/`, { signal, headers: { accept: "text/html", "user-agent": UA }, redirect: "follow" });
        const type = response.headers.get("content-type") ?? "";
        const text = type.includes("text/html") || type.includes("javascript") ? await readLimited(response, maxBytes) : "";
        return { status: response.status, text };
      });
      if (result) {
        status = result.status;
        html = result.text;
        break;
      }
    }
  }
  return scoreEvidence({ domain, resolves, html, status, ageDays, certDays, now });
}

/** Gathers evidence for hints one at a time, remembering each name for a day. */
export class EvidenceQueue {
  private readonly pending: string[] = [];
  private running = false;

  constructor(
    private readonly options: ProbeOptions & { ttlMs?: number | undefined; log?: ((line: string) => void) | undefined },
    private readonly known: (domain: string) => Evidence | null,
    private readonly store: (domain: string, evidence: Evidence) => void,
  ) {}

  enqueue(domain: string): void {
    const ttl = this.options.ttlMs ?? 24 * 60 * 60 * 1000;
    const existing = this.known(domain);
    if (existing && (this.options.clock ?? Date.now)() - existing.checkedAt < ttl) return;
    if (this.pending.includes(domain)) return;
    this.pending.push(domain);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let domain = this.pending.shift(); domain !== undefined; domain = this.pending.shift()) {
        const evidence = await gatherEvidence(domain, this.options);
        this.store(domain, evidence);
        this.options.log?.(`evidence for ${domain}: ${evidence.score}/100${evidence.marks.length > 0 ? `, ${evidence.marks.join("; ")}` : ""}`);
      }
    } finally {
      this.running = false;
    }
  }
}
