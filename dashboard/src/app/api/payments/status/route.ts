import { NextRequest, NextResponse } from 'next/server';

const PAYMENTS_BASE_URL =
  process.env.PAYMENTS_INTERNAL_URL ?? process.env.PAYMENTS_API_BASE_URL ?? 'http://payments:4000';

type PaymentsStatusResponse = {
  wallet?: string;
  expiresAt?: string;
  remainingDays?: number;
  error?: string;
};

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function upstreamHealth(baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/health`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const baseUrl = normalizeBaseUrl(PAYMENTS_BASE_URL);

  if (!baseUrl) {
    return NextResponse.json({ verified: false, error: 'Payments API not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    const healthy = await upstreamHealth(baseUrl);
    const status = healthy ? 200 : 502;
    return NextResponse.json(
      {
        verified: false,
        health: healthy,
        error: healthy ? 'Authorization required' : 'Payments service unavailable',
      },
      { status }
    );
  }

  try {
    const upstreamResponse = await fetch(`${baseUrl}/status`, {
      headers: {
        Authorization: authHeader,
      },
      cache: 'no-store',
    });

    const rawBody = await upstreamResponse.text();
    let data: PaymentsStatusResponse | undefined;

    try {
      data = rawBody ? (JSON.parse(rawBody) as PaymentsStatusResponse) : undefined;
    } catch {
      data = undefined;
    }

    if (!upstreamResponse.ok || !data) {
      const errorMessage = data?.error ?? 'Unable to confirm payment status';
      if (upstreamResponse.status === 401 || upstreamResponse.status === 404) {
        return NextResponse.json({ verified: false, error: errorMessage }, { status: upstreamResponse.status });
      }

      return NextResponse.json({ verified: false, error: errorMessage }, { status: upstreamResponse.status || 500 });
    }

    return NextResponse.json(
      {
        verified: true,
        wallet: data.wallet,
        expiresAt: data.expiresAt,
        remainingDays: data.remainingDays,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error contacting payments service';
    return NextResponse.json({ verified: false, error: message }, { status: 502 });
  }
}
