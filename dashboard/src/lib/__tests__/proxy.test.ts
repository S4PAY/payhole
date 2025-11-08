import { checkProxyHealth } from '@/lib/proxy';
import { resetConfigForTests } from '@/lib/config';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, NEXT_PUBLIC_PROXY_HEALTH_URL: 'http://localhost:8080/health' };
  resetConfigForTests();
});

afterAll(() => {
  process.env = originalEnv;
});

describe('checkProxyHealth', () => {
  it('reports ok when health endpoint is reachable', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);

    const result = await checkProxyHealth(fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/health',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.status).toBe('ok');
  });

  it('reports degraded when health endpoint returns an error', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false } as Response);

    const result = await checkProxyHealth(fetchMock as unknown as typeof fetch);

    expect(result.status).toBe('degraded');
  });
});

