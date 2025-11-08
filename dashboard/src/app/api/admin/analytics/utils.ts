import jwt from 'jsonwebtoken';

export type AnalyticsMetrics = {
  dau: number;
  paidUsers: number;
  blockedRequests: number;
  revenue: number;
};

export const FALLBACK_METRICS: AnalyticsMetrics = {
  dau: 0,
  paidUsers: 0,
  blockedRequests: 0,
  revenue: 0,
};

export function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  const [scheme, token] = headerValue.split(' ');
  if (!token || !/^Bearer$/i.test(scheme)) {
    return null;
  }
  return token.trim();
}

export function requireValidAdminToken(headerValue: string | null, secret: string): string {
  const token = extractBearerToken(headerValue);
  if (!token) {
    throw new Error('Missing admin token');
  }

  try {
    jwt.verify(token, secret);
  } catch (error) {
    throw new Error('Invalid admin token');
  }

  return token;
}

export function normalizeMetrics(payload: Partial<AnalyticsMetrics> | null): AnalyticsMetrics {
  if (!payload) {
    return { ...FALLBACK_METRICS };
  }
  return {
    dau: Number.isFinite(payload.dau) ? Number(payload.dau) : 0,
    paidUsers: Number.isFinite(payload.paidUsers) ? Number(payload.paidUsers) : 0,
    blockedRequests: Number.isFinite(payload.blockedRequests) ? Number(payload.blockedRequests) : 0,
    revenue: Number.isFinite(payload.revenue) ? Number(payload.revenue) : 0,
  };
}


