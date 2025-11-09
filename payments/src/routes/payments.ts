import { Router } from 'express';
import { UnlockStore } from '@/db/unlockStore';
import { issueUnlockToken, verifyUnlockToken } from '@/services/auth';
import { verifySolanaPayment } from '@/services/solana';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type PaymentsRouterDeps = {
  unlockStore: UnlockStore;
  unlockWebhookUrl?: string;
};

export function createPaymentsRouter({
  unlockStore,
  unlockWebhookUrl,
}: PaymentsRouterDeps): Router {
  const router = Router();

  router.post('/pay', async (req, res) => {
    const { wallet, signature } = req.body ?? {};

    if (typeof wallet !== 'string' || typeof signature !== 'string') {
      return res.status(400).json({ error: 'wallet and signature are required' });
    }

    try {
      console.info('[payments] verifying signature', { wallet, signature });
      const verification = await verifySolanaPayment(wallet, signature);
      console.info('[payments] verification success', {
        wallet,
        signature,
        amount: verification.amount,
        slot: verification.slot,
      });
      const { token, expiresAt } = issueUnlockToken(wallet);
      const record = await unlockStore.upsert(wallet, signature, expiresAt);
      const clientIp =
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        req.ip ??
        undefined;

      notifyProxyUnlock(unlockWebhookUrl, record, clientIp).catch(() => {
        // Ignore webhook failures; proxy will fall back to polling/token validation.
      });

      return res.status(200).json({
        token,
        expiresAt: record.expiresAt,
        wallet: record.wallet,
        amount: verification.amount,
        mint: verification.mint,
        slot: verification.slot,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[payments] verification failed', { wallet, signature, error: message });
      return res.status(400).json({ error: message });
    }
  });

  router.get('/status', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const [, token] = authHeader.split(' ');
    if (!token) {
      return res.status(401).json({ error: 'Invalid Authorization header format' });
    }

    try {
      const payload = verifyUnlockToken(token);
      const record = await unlockStore.get(payload.wallet);

      if (!record) {
        return res.status(404).json({ error: 'Unlock record not found' });
      }

      const expiresAt = new Date(record.expiresAt);
      const remainingDaysRaw = (expiresAt.getTime() - Date.now()) / DAY_IN_MS;
      const remainingDays = Math.max(0, Math.ceil(remainingDaysRaw));

      return res.status(200).json({
        wallet: record.wallet,
        expiresAt: record.expiresAt,
        remainingDays,
        signature: record.signature,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid token';
      return res.status(401).json({ error: message });
    }
  });

  router.get('/unlocks', async (req, res) => {
    const wallet = typeof req.query.wallet === 'string' ? req.query.wallet : undefined;
    if (wallet) {
      const record = await unlockStore.get(wallet);
      if (!record) {
        return res.status(404).json({ error: 'Unlock record not found' });
      }
      return res.status(200).json({ records: [record] });
    }

    const records = await unlockStore.all();
    return res.status(200).json({ records });
  });

  return router;
}

async function notifyProxyUnlock(
  webhookUrl: string | undefined,
  record: Awaited<ReturnType<UnlockStore['upsert']>>,
  clientIp?: string
) {
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet: record.wallet,
        expiresAt: record.expiresAt,
        updatedAt: record.updatedAt,
        clientIp,
      }),
    });
  } catch {
    // ignore webhook errors
  }
}