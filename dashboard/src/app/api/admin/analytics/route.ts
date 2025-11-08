import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const ANALYTICS_API_BASE_URL = process.env.ANALYTICS_API_BASE_URL;

type RevenueBreakdown = {
  daily: number;
  monthly: number;
  currency: string;
};

type AnalyticsMetrics = {
  dau: number;
  paidUsers: number;
  blockedRequests: number;
  revenue: RevenueBreakdown;
  updatedAt: string;
};

type UpstreamResponse = {
  dau?: number;
  paidUsers?: number;
  blockedRequests?: number;
  revenue?: RevenueBreakdown;
  updatedAt?: string;
  error?: string;
};

function extractToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const [scheme, value] = authHeader.split(' ');
  if (!value || !/^Bearer$/i.test(scheme)) {
    return null;
  }

  return value.trim();
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function fallbackMetrics(): AnalyticsMetrics {
  return {
    dau: 1280,
    paidUsers: 312,
    blockedRequests: 187456,
    revenue: {
      daily: 942.4,
      monthly: 28175.2,
      currency: 'USDC',
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  if (!ADMIN_JWT_SECRET) {
    return NextResponse.json(
      { error: 'Admin authentication is not configured' },
      { status: 500 }
    );
  }

  const token = extractToken(request.headers.get('authorization'));

  if (!token) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
  }

  try {
    jwt.verify(token, ADMIN_JWT_SECRET);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid admin token' }, { status: 401 });
  }

  try {
    if (!ANALYTICS_API_BASE_URL) {
      return NextResponse.json({ metrics: fallbackMetrics() }, { status: 200 });
    }

    const upstreamResponse = await fetch(`${normalizeBaseUrl(ANALYTICS_API_BASE_URL)}/analytics`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    const payloadText = await upstreamResponse.text();
    let data: UpstreamResponse | null = null;

    try {
      data = payloadText ? (JSON.parse(payloadText) as UpstreamResponse) : null;
    } catch {
      data = null;
    }

    if (!upstreamResponse.ok || !data) {
      const message = data?.error ?? 'Failed to fetch analytics data';
      return NextResponse.json({ error: message }, { status: upstreamResponse.status || 502 });
    }

    const metrics: AnalyticsMetrics = {
      dau: data.dau ?? 0,
      paidUsers: data.paidUsers ?? 0,
      blockedRequests: data.blockedRequests ?? 0,
      revenue: {
        daily: data.revenue?.daily ?? 0,
        monthly: data.revenue?.monthly ?? 0,
        currency: data.revenue?.currency ?? 'USDC',
      },
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    };

    return NextResponse.json({ metrics }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected analytics error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

