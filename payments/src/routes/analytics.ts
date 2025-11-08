import { Router } from 'express';
import { AnalyticsStore } from '@/analytics/analyticsStore';

type AnalyticsRouterDeps = {
  store: AnalyticsStore;
};

export function createAnalyticsRouter({ store }: AnalyticsRouterDeps): Router {
  const router = Router();

  router.post('/events', (req, res) => {
    const { domain, reason } = req.body ?? {};
    if (typeof domain !== 'string' || typeof reason !== 'string') {
      return res.status(400).json({ error: 'domain and reason are required' });
    }

    store.record(domain, reason, new Date().toISOString());
    return res.status(202).json({ status: 'accepted' });
  });

  router.get('/summary', (_req, res) => {
    const summary = store.summary();
    return res.status(200).json(summary);
  });

  return router;
}

