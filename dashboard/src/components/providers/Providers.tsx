"use client";

import { ReactNode } from 'react';
import { WalletProvider } from './WalletProvider';
import { PaymentStatusProvider } from './PaymentStatusProvider';

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <WalletProvider>
      <PaymentStatusProvider>{children}</PaymentStatusProvider>
    </WalletProvider>
  );
}

