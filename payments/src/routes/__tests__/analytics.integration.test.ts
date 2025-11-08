import request from 'supertest';
import { createApp } from '@/app';

describe('analytics routes', () => {
  it('accepts analytics events with optional metadata and returns summary', async () => {
    const { app } = createApp();

    await request(app)
      .post('/analytics/events')
      .send({
        domain: 'ads.example.com',
        reason: 'ad_block',
        riskScore: 0.8,
        clientIp: '203.0.113.10',
        userAgent: 'jest-test',
        userId: 'user-123',
      })
      .expect(202);

    const response = await request(app).get('/analytics/summary').expect(200);

    expect(response.body.totalBlocked).toBe(1);
    expect(response.body.blockedByReason.ad_block).toBe(1);
    expect(Array.isArray(response.body.latestEvents)).toBe(true);
    expect(response.body.latestEvents[0].riskScore).toBeCloseTo(0.8);
    expect(response.body.latestEvents[0].clientIp).toBe('203.0.113.10');
  });

  it('rejects invalid payloads', async () => {
    const { app } = createApp();

    const response = await request(app)
      .post('/analytics/events')
      .send({ domain: 'example.com', reason: 42 })
      .expect(400);

    expect(response.body.error).toBeDefined();
  });
});
