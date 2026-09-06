import { requireOptionalNativeModule, type NativeModule } from "expo-modules-core";

import type { NativeState, StartConfig } from "./src/types";

export type { BlockedName, DnsStatus, HistoryBucket, NativeState, StartConfig } from "./src/types";

// Expo's EventsMap wants an index signature, which an interface would not get implicitly.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type PayholeDnsEvents = {
  stateChanged: (state: NativeState) => void;
  sharedText: (payload: { text: string }) => void;
};

/**
 * The native module as both platforms expose it. Android functions that finish immediately are
 * synchronous; iOS talks to NEDNSSettingsManager and is asynchronous throughout. Callers go
 * through src/native/dns.ts, which awaits everything and fills in the unsupported case.
 */
export declare class PayholeDnsNativeModule extends NativeModule<PayholeDnsEvents> {
  isSupported(): boolean;
  /** Android: shows the system VPN consent dialog when needed. iOS: resolves true. */
  prepare(): Promise<boolean>;
  start(config: StartConfig): void | Promise<void>;
  stop(): void | Promise<void>;
  getState(): NativeState | Promise<NativeState>;
  /** Android: the VPN settings page. iOS: this app's page in Settings. */
  openSettings(): void;
  /** Android 13+ notification permission for the foreground service; other platforms resolve true. */
  requestNotificationPermission(): Promise<boolean | { status?: string; granted?: boolean }>;
  /** Text the app was opened with through the share sheet, once; null when there is none. */
  takeSharedText(): string | null;
}

export const PayholeDns = requireOptionalNativeModule<PayholeDnsNativeModule>("PayholeDns");
