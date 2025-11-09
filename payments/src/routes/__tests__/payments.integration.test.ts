import request from 'supertest';
import { createApp } from '@/app';
import { getEnv } from '@/config/env';

describe('payments routes', () => {
  const wallet = '5Yoqr4y9i4dFvTm9xWqgZaD5g1K8cAAXXXXXXX';
  const signature = '4cX9HYrXv8KpNNzzExampleSignature123';

  beforeEach(() => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  it('rejects requests with invalid payloads', async () => {
    const { app } = createApp();

    const response = await request(app).post('/pay').send({ wallet });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('verifies payment and returns JWT plus status', async () => {
    const env = getEnv();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          slot: 123,
          meta: {
            err: null,
            preTokenBalances: [
              {
                accountIndex: 1,
                mint: env.USDC_MINT_ADDRESS,
                owner: wallet,
                uiTokenAmount: { uiAmount: 6 },
              },
              {
                accountIndex: 2,
                mint: env.USDC_MINT_ADDRESS,
                owner: env.TREASURY_WALLET,
                uiTokenAmount: { uiAmount: 2 },
              },
            ],
            postTokenBalances: [
              {
                accountIndex: 1,
                mint: env.USDC_MINT_ADDRESS,
                owner: wallet,
                uiTokenAmount: { uiAmount: 1 },
              },
              {
                accountIndex: 2,
                mint: env.USDC_MINT_ADDRESS,
                owner: env.TREASURY_WALLET,
                uiTokenAmount: { uiAmount: 7 },
              },
            ],
          },
          transaction: {
            message: {
              accountKeys: [{ pubkey: wallet }],
            },
          },
        },
      }),
    } as unknown as Response);

    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const { app } = createApp();

    const payResponse = await request(app)
      .post('/pay')
      .send({ wallet, signature })
      .expect(200);

    expect(payResponse.body.token).toBeDefined();
    expect(payResponse.body.amount).toBeCloseTo(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const token = payResponse.body.token as string;

    const statusResponse = await request(app)
      .get('/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(statusResponse.body.wallet).toBe(wallet);
    expect(statusResponse.body.remainingDays).toBeGreaterThanOrEqual(29);
    expect(statusResponse.body.signature).toBe(signature);
    expect(statusResponse.body.expiresAt).toBeDefined();

    const unlockResponse = await request(app)
      .get('/unlocks')
      .query({ wallet })
      .expect(200);

    expect(unlockResponse.body.records).toHaveLength(1);
  });

  it('returns 401 for invalid tokens', async () => {
    const { app } = createApp();

    const response = await request(app)
      .get('/status')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
  });
});
