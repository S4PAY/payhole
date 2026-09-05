/**
 * Resolver settings: the public PayHole resolver or a custom one the user types in.
 * Pure functions only; persistence lives in persist.ts so this file can be unit tested.
 */

export type ResolverKind = "public" | "custom";

export interface ResolverSettings {
  kind: ResolverKind;
  customDohUrl: string;
  customDotHost: string;
}

/** What the native side is told to use. At least one of the two transports is set. */
export interface ActiveResolver {
  label: string;
  dohUrl: string | null;
  dotHost: string | null;
}

export const PUBLIC_RESOLVER: ActiveResolver = {
  label: "PayHole",
  dohUrl: "https://dns.payhole.org/dns-query",
  dotHost: "dns.payhole.org",
};

export const DEFAULT_SETTINGS: ResolverSettings = {
  kind: "public",
  customDohUrl: "",
  customDotHost: "",
};

export const SETTINGS_KEY = "payhole.resolver.v1";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Accepts an https URL with a host and no credentials; returns it trimmed, or null. */
export function normalizeDohUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (!HOSTNAME.test(url.hostname)) return null;
  return url.toString();
}

/** Accepts a bare host name (no scheme, port, or path); returns it lower-cased, or null. */
export function normalizeDotHost(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed === "") return null;
  return HOSTNAME.test(trimmed) ? trimmed : null;
}

export type Validation = { ok: true; active: ActiveResolver } | { ok: false; error: string };

/** Turns saved settings into the resolver the tunnel should use, or an error to show. */
export function validateSettings(settings: ResolverSettings): Validation {
  if (settings.kind === "public") return { ok: true, active: PUBLIC_RESOLVER };

  const dohInput = settings.customDohUrl.trim();
  const dotInput = settings.customDotHost.trim();
  if (dohInput === "" && dotInput === "") {
    return { ok: false, error: "Enter a DNS-over-HTTPS URL, a DNS-over-TLS host, or both." };
  }
  const dohUrl = dohInput === "" ? null : normalizeDohUrl(dohInput);
  if (dohInput !== "" && dohUrl === null) {
    return { ok: false, error: "The DNS-over-HTTPS URL must start with https:// and name a host." };
  }
  const dotHost = dotInput === "" ? null : normalizeDotHost(dotInput);
  if (dotInput !== "" && dotHost === null) {
    return { ok: false, error: "The DNS-over-TLS host must be a plain host name such as dns.example.org." };
  }
  const label = dotHost ?? new URL(dohUrl ?? "").hostname;
  return { ok: true, active: { label, dohUrl, dotHost } };
}

function isKind(value: unknown): value is ResolverKind {
  return value === "public" || value === "custom";
}

/** Restores settings from storage; anything unreadable falls back to the defaults. */
export function parseSettings(raw: string | null | undefined): ResolverSettings {
  if (raw === null || raw === undefined || raw === "") return { ...DEFAULT_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SETTINGS };
  const record = parsed as Record<string, unknown>;
  return {
    kind: isKind(record["kind"]) ? record["kind"] : DEFAULT_SETTINGS.kind,
    customDohUrl: typeof record["customDohUrl"] === "string" ? record["customDohUrl"] : "",
    customDotHost: typeof record["customDotHost"] === "string" ? record["customDotHost"] : "",
  };
}

export function serializeSettings(settings: ResolverSettings): string {
  return JSON.stringify({
    kind: settings.kind,
    customDohUrl: settings.customDohUrl,
    customDotHost: settings.customDotHost,
  });
}

/** The subset of AsyncStorage the app relies on, so tests can pass a Map-backed stand-in. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export async function loadSettings(storage: KeyValueStorage): Promise<ResolverSettings> {
  try {
    return parseSettings(await storage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(storage: KeyValueStorage, settings: ResolverSettings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, serializeSettings(settings));
}
