'use client';

import { ReactNode, useMemo } from 'react';
import { createContext, useContext } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import usePaymentStatus, {
  PaymentStatusValue,
} from '@/hooks/usePaymentStatus';

const PaymentStatusContext = createContext<PaymentStatusValue | null>(null);

type Props = {
  children: ReactNode;
};

export function PaymentStatusProvider({ children }: Props) {
  const { publicKey } = useWallet();
  const walletAddress = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const paymentStatus = usePaymentStatus(walletAddress);

  return (
    <PaymentStatusContext.Provider value={paymentStatus}>
      {children}
    </PaymentStatusContext.Provider>
  );
}

export function usePaymentStatusContext(): PaymentStatusValue {
  const context = useContext(PaymentStatusContext);
  if (!context) {
    throw new Error('usePaymentStatusContext must be used within a PaymentStatusProvider');
  }
  return context;
}

