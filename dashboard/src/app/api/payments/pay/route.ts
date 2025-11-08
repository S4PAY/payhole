import { NextRequest, NextResponse } from 'next/server';

const PAYMENTS_BASE_URL = process.env.PAYMENTS_API_BASE_URL ?? 'http://localhost:4000';

type PaymentsPayResponse = {
  token?: string;
  expiresAt?: string;
  remainingDays?: number;
  wallet?: string;
  error?: string;
};

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function POST(request: NextRequest) {
  const baseUrl = normalizeBaseUrl(PAYMENTS_BASE_URL);

  if (!baseUrl) {
    return NextResponse.json({ verified: false, error: 'Payments API not configured' }, { status: 500 });
  }

  const { wallet, signature } = (await request.json().catch(() => ({}))) as {
    wallet?: string;
    signature?: string;
  };

  if (!wallet || typeof wallet !== 'string') {
    return NextResponse.json({ verified: false, error: 'Wallet is required' }, { status: 400 });
  }

  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ verified: false, error: 'Transaction signature is required' }, { status: 400 });
  }

  try {
    const upstreamResponse = await fetch(`${baseUrl}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ wallet, signature }),
      cache: 'no-store',
    });

    const rawBody = await upstreamResponse.text();
    let data: PaymentsPayResponse | undefined;

    try {
      data = rawBody ? (JSON.parse(rawBody) as PaymentsPayResponse) : undefined;
    } catch (error) {
      data = undefined;
    }

    if (!upstreamResponse.ok || !data?.token) {
      const errorMessage = data?.error ?? 'Payment verification failed';
      return NextResponse.json({ verified: false, error: errorMessage }, { status: upstreamResponse.status || 500 });
    }

    return NextResponse.json(
      {
        verified: true,
        token: data.token,
        expiresAt: data.expiresAt,
        remainingDays: data.remainingDays,
        wallet: data.wallet ?? wallet,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error contacting payments service';
    return NextResponse.json({ verified: false, error: message }, { status: 502 });
  }
}


