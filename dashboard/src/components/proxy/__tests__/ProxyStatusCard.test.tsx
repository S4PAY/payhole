import { render, screen, waitFor } from '@testing-library/react';
import ProxyStatusCard from '@/components/proxy/ProxyStatusCard';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr'),
}));

const mockUsePaymentStatusContext = jest.fn();
jest.mock('@/components/providers/PaymentStatusProvider', () => ({
  usePaymentStatusContext: () => mockUsePaymentStatusContext(),
}));

const mockUseAnalyticsSummary = jest.fn().mockReturnValue({
  totalBlocked: 42,
  blockedByReason: { ad_block: 40, premium_unlock_required: 2 },
  updatedAt: new Date().toISOString(),
  error: undefined,
  loading: false,
});
jest.mock('@/hooks/useAnalyticsSummary', () => ({
  useAnalyticsSummary: () => mockUseAnalyticsSummary(),
}));

describe('ProxyStatusCard', () => {
  beforeEach(() => {
    mockUsePaymentStatusContext.mockReturnValue({
      verified: true,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    } as Response);
  });

  it('shows secured status and analytics summary', async () => {
    render(<ProxyStatusCard />);

    await waitFor(() => {
      expect(screen.getByText(/Proxy Status: ✅ Secured/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Blocked Requests/)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/Download auto-config script/)).toBeInTheDocument();
  });
});

