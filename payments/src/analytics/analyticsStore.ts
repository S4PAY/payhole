export type AnalyticsEvent = {
  domain: string;
  reason: string;
  timestamp: string;
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

  constructor(maxEvents: number) {
    this.maxEvents = maxEvents;
  }

  record(domain: string, reason: string, timestamp: string) {
    this.totalBlocked += 1;
    this.blockedByReason[reason] = (this.blockedByReason[reason] ?? 0) + 1;

    const event: AnalyticsEvent = { domain, reason, timestamp };
    this.latestEvents.unshift(event);
    if (this.latestEvents.length > this.maxEvents) {
      this.latestEvents.length = this.maxEvents;
    }
  }

  summary(): AnalyticsSummary {
    return {
      totalBlocked: this.totalBlocked,
      blockedByReason: { ...this.blockedByReason },
      latestEvents: [...this.latestEvents],
      updatedAt: this.latestEvents.length > 0 ? this.latestEvents[0].timestamp : null,
    };
  }
}

