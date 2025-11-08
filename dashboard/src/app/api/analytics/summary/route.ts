import { NextResponse } from 'next/server';

const PAYMENTS_BASE_URL = process.env.PAYMENTS_API_BASE_URL ?? 'http://localhost:4000';

function normalize(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function GET() {
  try {
    const response = await fetch(`${normalize(PAYMENTS_BASE_URL)}/analytics/summary`, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      const message = await response.text();
      return NextResponse.json({ error: message || 'Failed to load analytics' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected analytics error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

