const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZeh9Bx';
const DEFAULT_PAYMENT_AMOUNT = 5;

export type PaymentConfig = {
  treasuryAddress: string | null;
  amount: number;
  displayAmount: string;
  usdcMint: string;
  solanaPayUrl: string | null;
  phantomUrl: string | null;
};

let cachedPaymentConfig: PaymentConfig | null = null;

function parseAmount(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_PAYMENT_AMOUNT;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAYMENT_AMOUNT;
  }

  return parsed;
}

function formatAmount(amount: number): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildSolanaPayUrl(address: string, amount: number, mint: string): string {
  const params = new URLSearchParams();
  params.set('amount', amount.toFixed(2));
  params.set('spl-token', mint);
  params.set('label', 'PayHole');
  params.set('message', 'PayHole proxy unlock');
  return `solana:${address}?${params.toString()}`;
}

function buildPhantomUrl(solanaPayUrl: string): string {
  return `https://phantom.app/ul/v1/solana-pay?link=${encodeURIComponent(solanaPayUrl)}`;
}

export function getPaymentConfig(): PaymentConfig {
  if (cachedPaymentConfig) {
    return cachedPaymentConfig;
  }

  const rawTreasury = process.env.NEXT_PUBLIC_TREASURY_WALLET?.trim() ?? '';
  const treasuryAddress = rawTreasury.length >= 32 ? rawTreasury : null;
  const amount = parseAmount(process.env.NEXT_PUBLIC_PAYMENT_AMOUNT_USDC);
  const usdcMint =
    process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS?.trim() || DEFAULT_USDC_MINT;
  const displayAmount = formatAmount(amount);

  const solanaPayUrl =
    treasuryAddress !== null ? buildSolanaPayUrl(treasuryAddress, amount, usdcMint) : null;
  const phantomUrl = solanaPayUrl ? buildPhantomUrl(solanaPayUrl) : null;

  cachedPaymentConfig = {
    treasuryAddress,
    amount,
    displayAmount,
    usdcMint,
    solanaPayUrl,
    phantomUrl,
  };

  return cachedPaymentConfig;
}

export function resetPaymentConfigForTests() {
  cachedPaymentConfig = null;
}

