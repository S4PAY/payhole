import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAYMENTS_BASE_URL = process.env.PAYMENTS_API_BASE_URL ?? 'http://localhost:4000';
const BOOTED_AT = new Date().toISOString();

function normalize(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function checkPaymentsHealth(): Promise<{ status: 'ok' | 'error'; detail?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${normalize(PAYMENTS_BASE_URL)}/healthz`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = await response.text();
      return { status: 'error', detail: message || `payments responded with ${response.status}` };
    }

    return { status: 'ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return { status: 'error', detail: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const payments = await checkPaymentsHealth();
  const overallStatus = payments.status === 'ok' ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status: overallStatus,
      bootedAt: BOOTED_AT,
      uptime: process.uptime(),
      dependencies: {
        payments,
      },
    },
    { status: overallStatus === 'ok' ? 200 : 503 }
  );
}
