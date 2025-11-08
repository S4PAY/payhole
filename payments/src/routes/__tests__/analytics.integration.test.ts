import request from 'supertest';
import { createApp } from '@/app';

describe('analytics routes', () => {
  it('accepts analytics events and returns summary', async () => {
    const { app } = createApp();

    await request(app)
      .post('/analytics/events')
      .send({ domain: 'ads.example.com', reason: 'ad_block' })
      .expect(202);

    const response = await request(app).get('/analytics/summary').expect(200);

    expect(response.body.totalBlocked).toBe(1);
    expect(response.body.blockedByReason.ad_block).toBe(1);
    expect(Array.isArray(response.body.latestEvents)).toBe(true);
  });
});

