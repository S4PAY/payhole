import { render, screen } from '@testing-library/react';
import LoginStatus from '../LoginStatus';

const mockUseWallet = jest.fn();
const mockPaymentStatus = jest.fn();

jest.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock('@solana/wallet-adapter-react-ui', () => ({
  WalletMultiButton: ({ 'data-testid': dataTestId, className }: { 'data-testid'?: string; className?: string }) => (
    <button type="button" data-testid={dataTestId} className={className}>
      Select Wallet
    </button>
  ),
}));

jest.mock('@/components/providers/PaymentStatusProvider', () => ({
  usePaymentStatusContext: () => mockPaymentStatus(),
}));

describe('LoginStatus', () => {
  beforeEach(() => {
    mockUseWallet.mockReset();
    mockPaymentStatus.mockReset();
  });

  it('renders disconnected state', () => {
    mockUseWallet.mockReturnValue({ connected: false, publicKey: null });
    mockPaymentStatus.mockReturnValue({
      verifying: false,
      verified: false,
      remainingDays: null,
      expiresAt: null,
      error: undefined,
      verifyPayment: jest.fn(),
      clearError: jest.fn(),
      clearToken: jest.fn(),
    });

    render(<LoginStatus />);

    expect(screen.getByTestId('wallet-multi-button')).toBeInTheDocument();
    expect(screen.getByText('Wallet disconnected')).toBeInTheDocument();
  });

  it('renders shortened address when connected', () => {
    const publicKey = { toBase58: () => '9xSgjGJpF4ch8VWa1kR2Y7kz6UvCLq' };
    mockUseWallet.mockReturnValue({ connected: true, publicKey });
    mockPaymentStatus.mockReturnValue({
      verifying: false,
      verified: false,
      remainingDays: null,
      expiresAt: null,
      error: undefined,
      verifyPayment: jest.fn(),
      clearError: jest.fn(),
      clearToken: jest.fn(),
    });

    render(<LoginStatus />);

    expect(screen.getByText('Wallet: 9xSg…vCLq')).toBeInTheDocument();
  });
});

