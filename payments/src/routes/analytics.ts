import { Router } from 'express';
import { AnalyticsStore } from '@/analytics/analyticsStore';

type AnalyticsRouterDeps = {
  store: AnalyticsStore;
};

const MAX_REASON_LENGTH = 128;

export function createAnalyticsRouter({ store }: AnalyticsRouterDeps): Router {
  const router = Router();

  router.post('/events', (req, res) => {
    const { domain, reason, riskScore, userAgent, clientIp, userId } = req.body ?? {};
    if (typeof domain !== 'string' || typeof reason !== 'string') {
      return res.status(400).json({ error: 'domain and reason are required' });
    }
    if (!domain.trim() || !reason.trim()) {
      return res.status(400).json({ error: 'domain and reason must be non-empty' });
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return res.status(400).json({ error: 'reason too long' });
    }
    if (riskScore !== undefined && typeof riskScore !== 'number') {
      return res.status(400).json({ error: 'riskScore must be a number when provided' });
    }
    if (clientIp && typeof clientIp !== 'string') {
      return res.status(400).json({ error: 'clientIp must be a string when provided' });
    }
    if (userAgent && typeof userAgent !== 'string') {
      return res.status(400).json({ error: 'userAgent must be a string when provided' });
    }
    if (userId && typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId must be a string when provided' });
    }

    const timestamp = new Date().toISOString();
    store.record(domain, reason, timestamp, {
      riskScore,
      userAgent,
      clientIp,
      userId,
    });
    return res.status(202).json({ status: 'accepted' });
  });

  router.get('/summary', (_req, res) => {
    const summary = store.summary();
    return res.status(200).json(summary);
  });

  return router;
}
