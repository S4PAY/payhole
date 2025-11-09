import { render, screen } from '@testing-library/react';

import PaymentVerification from '@/components/dashboard/PaymentVerification';
import { usePaymentStatusContext } from '@/components/providers/PaymentStatusProvider';
import { resetPaymentConfigForTests } from '@/lib/paymentConfig';

jest.mock('@/components/providers/PaymentStatusProvider', () => ({
  usePaymentStatusContext: jest.fn(),
}));

const mockUsePaymentStatus = usePaymentStatusContext as unknown as jest.Mock;

const baseContext = {
  walletAddress: 'wallet123',
  verified: false,
  loading: false,
  verifying: false,
  remainingDays: null,
  expiresAt: null,
  error: undefined,
  token: null,
  refresh: jest.fn(),
  verifyPayment: jest.fn(),
  clearError: jest.fn(),
  clearToken: jest.fn(),
};

beforeEach(() => {
  resetPaymentConfigForTests();
  process.env.NEXT_PUBLIC_TREASURY_WALLET =
    'PayholeTreasury11111111111111111111111111111';
  process.env.NEXT_PUBLIC_PAYMENT_AMOUNT_USDC = '5';
  process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS =
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZeh9Bx';
  mockUsePaymentStatus.mockReturnValue(baseContext);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('PaymentVerification', () => {
  it('renders payment instructions when wallet is connected but not verified', () => {
    render(<PaymentVerification />);

    expect(
      screen.getByText(/Authenticate premium access/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Treasury wallet/i)[0]).toBeInTheDocument();
    expect(screen.getByLabelText(/Transaction Signature/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open in wallet/i })
    ).toHaveAttribute('href', expect.stringContaining('solana:'));
  });

  it('shows access granted when verification already complete', () => {
    mockUsePaymentStatus.mockReturnValue({
      ...baseContext,
      verified: true,
      expiresAt: new Date().toISOString(),
    });

    render(<PaymentVerification />);

    expect(screen.getByText(/Access Granted/i)).toBeInTheDocument();
  });
});

