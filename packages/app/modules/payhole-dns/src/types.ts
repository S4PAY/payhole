/** Shared shape of what the native side reports, identical on Android and iOS. */
export type DnsStatus = "off" | "connecting" | "on" | "error";

export interface HistoryBucket {
  /** Start of the slice as Unix milliseconds. */
  start: number;
  queries: number;
  blocked: number;
}

export interface NativeState {
  status: DnsStatus;
  /** iOS: the profile is installed but the user has not selected it in Settings yet. */
  needsUserAction: boolean;
  /** Label of the resolver in use, or null when off. */
  resolver: string | null;
  /** Queries the Android tunnel saw in the last 24 hours. Always 0 on iOS. */
  queries: number;
  /** Answers the resolver blocked in the last 24 hours. Always 0 on iOS. */
  blocked: number;
  /** Most recent blocked names, newest first, at most 20. Empty on iOS. */
  recentBlocked: string[];
  /** Forty-eight half-hour slices, oldest first, covering the last 24 hours. Empty on iOS. */
  history: HistoryBucket[];
  error: string | null;
}

export interface StartConfig {
  /** DNS-over-HTTPS endpoint, tried first on Android; the only transport iOS profiles use here. */
  dohUrl: string | null;
  /** DNS-over-TLS host on port 853, the Android fallback and the iOS choice when no URL is set. */
  dotHost: string | null;
  /** Shown in the Android notification and the iOS DNS settings list. */
  label: string;
}
