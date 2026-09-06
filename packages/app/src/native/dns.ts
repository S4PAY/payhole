import { Platform } from "react-native";

import { PayholeDns, type NativeState, type PayholeDnsNativeModule, type StartConfig } from "../../modules/payhole-dns";

export type Unsubscribe = () => void;
export type DnsPlatform = "android" | "ios" | "other";

/** What the screens talk to. Every call is awaited; nothing here depends on the platform. */
export interface DnsController {
  readonly supported: boolean;
  readonly platform: DnsPlatform;
  prepare(): Promise<boolean>;
  start(config: StartConfig): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<NativeState>;
  subscribe(listener: (state: NativeState) => void): Unsubscribe;
  openSettings(): void;
  requestNotificationPermission(): Promise<boolean>;
  /** Text shared into the app at launch, once. */
  takeSharedText(): string | null;
  /** Text shared into the app while it is running. */
  onSharedText(listener: (text: string) => void): Unsubscribe;
}

export const OFF_STATE: NativeState = {
  status: "off",
  needsUserAction: false,
  resolver: null,
  queries: 0,
  blocked: 0,
  recentBlocked: [],
  history: [],
  error: null,
};

function detectPlatform(): DnsPlatform {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return "ios";
  return "other";
}

function fromNative(module: PayholeDnsNativeModule, platform: DnsPlatform): DnsController {
  return {
    supported: true,
    platform,
    prepare: () => module.prepare(),
    start: async (config) => {
      await module.start(config);
    },
    stop: async () => {
      await module.stop();
    },
    getState: async () => ({ ...OFF_STATE, ...(await module.getState()) }),
    subscribe: (listener) => {
      const subscription = module.addListener("stateChanged", listener);
      return () => subscription.remove();
    },
    openSettings: () => module.openSettings(),
    takeSharedText: () => module.takeSharedText(),
    onSharedText: (listener) => {
      const subscription = module.addListener("sharedText", (payload) => listener(payload.text));
      return () => subscription.remove();
    },
    requestNotificationPermission: async () => {
      const result = await module.requestNotificationPermission();
      if (typeof result === "boolean") return result;
      return result.granted === true || result.status === "granted";
    },
  };
}

function unsupported(platform: DnsPlatform): DnsController {
  const refuse = () => Promise.reject(new Error("Encrypted DNS needs the Android or iOS build of PayHole."));
  return {
    supported: false,
    platform,
    prepare: () => Promise.resolve(false),
    start: refuse,
    stop: () => Promise.resolve(),
    getState: () => Promise.resolve({ ...OFF_STATE }),
    subscribe: () => () => undefined,
    openSettings: () => undefined,
    takeSharedText: () => null,
    onSharedText: () => () => undefined,
    requestNotificationPermission: () => Promise.resolve(false),
  };
}

const platform = detectPlatform();

export const dns: DnsController =
  PayholeDns !== null && platform !== "other" ? fromNative(PayholeDns, platform) : unsupported(platform);
