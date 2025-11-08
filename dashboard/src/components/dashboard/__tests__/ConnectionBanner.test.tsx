import { render, screen } from '@testing-library/react';
import ConnectionBanner from '@/components/dashboard/ConnectionBanner';

const mockUseWallet = jest.fn();
const mockPaymentStatus = jest.fn();

jest.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock('@solana/wallet-adapter-react-ui', () => ({
  WalletMultiButton: ({ 'data-testid': dataTestId }: { 'data-testid'?: string }) => (
    <button type="button" data-testid={dataTestId}>
      Wallet Button
    </button>
  ),
}));

jest.mock('@/components/providers/PaymentStatusProvider', () => ({
  usePaymentStatusContext: () => mockPaymentStatus(),
}));

describe('ConnectionBanner', () => {
  beforeEach(() => {
    mockUseWallet.mockReset();
    mockPaymentStatus.mockReset();
  });

  it('shows disconnected state when wallet is not connected', () => {
    mockUseWallet.mockReturnValue({ connected: false, publicKey: null });
    mockPaymentStatus.mockReturnValue({
      verified: false,
      expiresAt: null,
    });

    render(<ConnectionBanner />);

    expect(screen.getByText('Wallet Disconnected')).toBeInTheDocument();
    expect(screen.getByText('Payment Pending')).toBeInTheDocument();
  });

  it('shows connected and verified state', () => {
    const publicKey = { toBase58: () => 'F1gVarSamplePublicKey123456789' };
    mockUseWallet.mockReturnValue({ connected: true, publicKey });
    mockPaymentStatus.mockReturnValue({
      verified: true,
      expiresAt: null,
    });

    render(<ConnectionBanner />);

    expect(screen.getByText(/Wallet Connected/)).toBeInTheDocument();
    expect(screen.getByText(/Payment Verified/)).toBeInTheDocument();
  });
});

