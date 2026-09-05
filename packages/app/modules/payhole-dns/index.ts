import { requireOptionalNativeModule, type NativeModule } from "expo-modules-core";

import type { NativeState, StartConfig } from "./src/types";

export type { DnsStatus, NativeState, StartConfig } from "./src/types";

type PayholeDnsEvents = Record<"stateChanged", (state: NativeState) => void>;

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
}

export const PayholeDns = requireOptionalNativeModule<PayholeDnsNativeModule>("PayholeDns");
