import { getEnv } from '@/config/env';

export type PaymentVerificationResult = {
  slot: number;
  signature: string;
  amount: number;
  mint: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<FetchResponse>;

type HeliusTransactionResponse = {
  result?: {
    slot: number;
    meta?: {
      err: unknown;
      postTokenBalances?: Array<{
        mint: string;
        owner?: string;
        uiTokenAmount?: {
          uiAmount: number | null;
        };
      }>;
    };
    transaction?: {
      message?: {
        accountKeys?: Array<{ pubkey: string } | string>;
      };
    };
  } | null;
  error?: {
    message?: string;
  };
};

const RPC_TIMEOUT_MS = 10_000;

export async function verifySolanaPayment(
  wallet: string,
  signature: string,
  fetchFn: FetchLike = fetch
): Promise<PaymentVerificationResult> {
  const { HELIUS_RPC_URL, USDC_MINT_ADDRESS } = getEnv();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const response = await fetchFn(HELIUS_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'payhole-payments',
        method: 'getTransaction',
        params: [signature, { commitment: 'confirmed', encoding: 'jsonParsed' }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Helius RPC request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as HeliusTransactionResponse;

    if (payload.error) {
      throw new Error(payload.error.message ?? 'Helius RPC returned an error');
    }

    if (!payload.result) {
      throw new Error('Transaction not found');
    }

    if (payload.result.meta?.err) {
      throw new Error('Transaction failed on-chain');
    }

    const accounts = payload.result.transaction?.message?.accountKeys ?? [];
    const accountStrings = accounts.map((account) =>
      typeof account === 'string' ? account : account.pubkey
    );

    if (!accountStrings.includes(wallet)) {
      throw new Error('Wallet address not present in transaction');
    }

    const tokenBalances = payload.result.meta?.postTokenBalances ?? [];
    const usdcBalance = tokenBalances.find(
      (balance) => balance.mint === USDC_MINT_ADDRESS && balance.owner === wallet
    );

    if (!usdcBalance) {
      throw new Error('No USDC balance recorded for wallet');
    }

    const amount = usdcBalance.uiTokenAmount?.uiAmount;
    if (amount === null || amount === undefined) {
      throw new Error('Unable to determine USDC transfer amount');
    }

    return {
      slot: payload.result.slot,
      signature,
      amount,
      mint: usdcBalance.mint,
    };
  } finally {
    clearTimeout(timeout);
  }
}

