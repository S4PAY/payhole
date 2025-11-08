import { TelemetryPublisher, TelemetryRecord } from '@/analytics/telemetryPublisher';

export type AnalyticsEvent = {
  domain: string;
  reason: string;
  timestamp: string;
  riskScore?: number;
  userAgent?: string;
  clientIp?: string;
};

export type AnalyticsSummary = {
  totalBlocked: number;
  blockedByReason: Record<string, number>;
  latestEvents: AnalyticsEvent[];
  updatedAt: string | null;
};

export class AnalyticsStore {
  private totalBlocked = 0;
  private blockedByReason: Record<string, number> = {};
  private latestEvents: AnalyticsEvent[] = [];
  private readonly maxEvents: number;
  private readonly publisher?: TelemetryPublisher;

  constructor(maxEvents: number, publisher?: TelemetryPublisher) {
    this.maxEvents = maxEvents;
    this.publisher = publisher;
  }

  record(domain: string, reason: string, timestamp: string, context: Omit<TelemetryRecord, 'domain' | 'reason' | 'timestamp'> = {}) {
    this.totalBlocked += 1;
    this.blockedByReason[reason] = (this.blockedByReason[reason] ?? 0) + 1;

    const event: AnalyticsEvent = { domain, reason, timestamp, ...context };
    this.latestEvents.unshift(event);
    if (this.latestEvents.length > this.maxEvents) {
      this.latestEvents.length = this.maxEvents;
    }

    if (this.publisher) {
      void this.publisher
        .publish({ domain, reason, timestamp, ...context })
        .catch(() => undefined);
    }
  }

  summary(): AnalyticsSummary {
    return {
      totalBlocked: this.totalBlocked,
      blockedByReason: { ...this.blockedByReason },
      latestEvents: [...this.latestEvents],
      updatedAt: this.latestEvents[0]?.timestamp ?? null,
    };
  }
}
