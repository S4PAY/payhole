import express from 'express';
import { getEnv } from '@/config/env';
import { UnlockStore } from '@/db/unlockStore';
import { createPaymentsRouter } from '@/routes/payments';
import { AnalyticsStore } from '@/analytics/analyticsStore';
import { createAnalyticsRouter } from '@/routes/analytics';

export type AppDeps = {
  unlockStore?: UnlockStore;
  analyticsStore?: AnalyticsStore;
};

export function createApp(deps: AppDeps = {}) {
  const env = getEnv();
  const unlockStore =
    deps.unlockStore ?? new UnlockStore(env.UNLOCK_DB_PATH ?? 'data/unlocks.json');
  const analyticsStore =
    deps.analyticsStore ?? new AnalyticsStore(env.ANALYTICS_BUFFER_LIMIT);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/analytics', createAnalyticsRouter({ store: analyticsStore }));
  const paymentsRouterDeps = {
    unlockStore,
    ...(env.PROXY_UNLOCK_WEBHOOK
      ? { unlockWebhookUrl: env.PROXY_UNLOCK_WEBHOOK }
      : {}),
  };

  app.use('/', createPaymentsRouter(paymentsRouterDeps));

  return { app, unlockStore, analyticsStore };
}