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
      preTokenBalances?: Array<{
        mint: string;
        owner?: string;
        uiTokenAmount?: {
          uiAmount: number | null;
        };
      }>;
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
const EPSILON = 0.000001;

type TokenBalance = {
  mint: string;
  owner?: string;
  uiTokenAmount?: {
    uiAmount: number | null;
  };
};

function findTokenBalance(
  balances: TokenBalance[] | undefined,
  owner: string,
  mint: string
): TokenBalance | undefined {
  if (!balances) {
    return undefined;
  }

  return balances.find(
    (balance) => balance.mint === mint && balance.owner === owner
  );
}

function balanceAmount(balance: TokenBalance | undefined): number {
  return balance?.uiTokenAmount?.uiAmount ?? 0;
}

export async function verifySolanaPayment(
  wallet: string,
  signature: string,
  fetchFn: FetchLike = fetch
): Promise<PaymentVerificationResult> {
  const { HELIUS_RPC_URL, USDC_MINT_ADDRESS, TREASURY_WALLET, MIN_PAYMENT_USDC } = getEnv();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    console.info('[payments:solana] fetching transaction', { wallet, signature });
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

    console.info('[payments:solana] transaction fetched', {
      wallet,
      signature,
      slot: payload.result.slot,
    });

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

    const postBalances = payload.result.meta?.postTokenBalances ?? [];
    console.info('[payments:solana] post balances', {
      wallet,
      signature,
      balances: postBalances,
    });
    const treasuryBalance = findTokenBalance(postBalances, TREASURY_WALLET, USDC_MINT_ADDRESS);

    if (!treasuryBalance) {
      throw new Error('Treasury wallet not present in transaction');
    }

    const preBalances = payload.result.meta?.preTokenBalances ?? [];
    console.info('[payments:solana] pre balances', {
      wallet,
      signature,
      balances: preBalances,
    });
    const treasuryPre = findTokenBalance(preBalances, TREASURY_WALLET, USDC_MINT_ADDRESS);
    const walletPre = findTokenBalance(preBalances, wallet, USDC_MINT_ADDRESS);
    const walletPost = findTokenBalance(postBalances, wallet, USDC_MINT_ADDRESS);

    console.info('[payments:solana] balance summary', {
      wallet,
      signature,
      treasuryWallet: TREASURY_WALLET,
      usdcMint: USDC_MINT_ADDRESS,
      treasuryPost: treasuryBalance,
      treasuryPre,
      walletPre,
      walletPost,
    });

    const treasuryDelta = balanceAmount(treasuryBalance) - balanceAmount(treasuryPre);
    if (treasuryDelta + EPSILON < MIN_PAYMENT_USDC) {
      throw new Error('Treasury did not receive required USDC amount');
    }

    const walletDelta = balanceAmount(walletPost) - balanceAmount(walletPre);
    if (walletDelta - EPSILON > -MIN_PAYMENT_USDC) {
      throw new Error('Wallet did not send required USDC amount');
    }

    return {
      slot: payload.result.slot,
      signature,
      amount: treasuryDelta,
      mint: treasuryBalance.mint,
    };
  } finally {
    clearTimeout(timeout);
  }
}

