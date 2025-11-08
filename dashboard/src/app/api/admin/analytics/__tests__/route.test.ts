import jwt from 'jsonwebtoken';

type GetHandler = typeof import('@/app/api/admin/analytics/route').GET;

const globalAny = globalThis as unknown as Record<string, unknown>;

class TestHeaders {
  private readonly map = new Map<string, string>();

  constructor(init: Record<string, string> = {}) {
    Object.entries(init).forEach(([key, value]) => {
      this.map.set(key.toLowerCase(), value);
    });
  }

  get(key: string): string | null {
    return this.map.get(key.toLowerCase()) ?? null;
  }

  set(key: string, value: string) {
    this.map.set(key.toLowerCase(), value);
  }
}

if (!globalAny.Headers) {
  globalAny.Headers = TestHeaders;
}

jest.mock('next/server', () => {
  return {
    NextRequest: class {
      headers: InstanceType<typeof TestHeaders>;
      constructor(init?: { headers?: Record<string, string> }) {
        this.headers = new TestHeaders(init?.headers ?? {});
      }
    },
    NextResponse: {
      json(body: unknown, init?: { status?: number }) {
        return {
          status: init?.status ?? 200,
          json: async () => body,
        };
      },
    },
  };
});

const originalEnv = process.env;

function createRequest(headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
  } as unknown as Parameters<GetHandler>[0];
}

describe('GET /api/admin/analytics', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANALYTICS_API_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 500 when admin secret is not configured', async () => {
    delete process.env.ADMIN_JWT_SECRET;

    let handler: GetHandler;
    jest.isolateModules(() => {
      ({ GET: handler } = require('@/app/api/admin/analytics/route') as { GET: GetHandler });
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it('rejects missing authorization header', async () => {
    process.env.ADMIN_JWT_SECRET = 'admin-secret-key-1234567890';

    let handler: GetHandler;
    jest.isolateModules(() => {
      ({ GET: handler } = require('@/app/api/admin/analytics/route') as { GET: GetHandler });
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(401);
  });

  it('rejects invalid tokens', async () => {
    process.env.ADMIN_JWT_SECRET = 'admin-secret-key-1234567890';

    let handler: GetHandler;
    jest.isolateModules(() => {
      ({ GET: handler } = require('@/app/api/admin/analytics/route') as { GET: GetHandler });
    });

    const response = await handler(
      createRequest({
        Authorization: 'Bearer invalid.token',
      })
    );

    expect(response.status).toBe(401);
  });

  it('returns fallback metrics when token is valid', async () => {
    process.env.ADMIN_JWT_SECRET = 'admin-secret-key-1234567890';
    const token = jwt.sign({ scope: 'admin' }, process.env.ADMIN_JWT_SECRET, { expiresIn: '1h' });

    let handler: GetHandler;
    jest.isolateModules(() => {
      ({ GET: handler } = require('@/app/api/admin/analytics/route') as { GET: GetHandler });
    });

    const response = await handler(
      createRequest({
        Authorization: `Bearer ${token}`,
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.metrics).toMatchObject({
      dau: expect.any(Number),
      paidUsers: expect.any(Number),
      blockedRequests: expect.any(Number),
      revenue: {
        daily: expect.any(Number),
        monthly: expect.any(Number),
        currency: expect.any(String),
      },
      updatedAt: expect.any(String),
    });
  });
});

