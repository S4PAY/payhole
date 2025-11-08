import { getEnv } from '@/config/env';
import { verifySolanaPayment } from '@/services/solana';

describe('verifySolanaPayment', () => {
  const wallet = 'wallet123';
  const signature = 'sig123';

  it('returns verification metadata when transaction is valid', async () => {
    const env = getEnv();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          slot: 12345,
          meta: {
            err: null,
            postTokenBalances: [
              {
                mint: env.USDC_MINT_ADDRESS,
                owner: wallet,
                uiTokenAmount: { uiAmount: 5 },
              },
            ],
          },
          transaction: {
            message: {
              accountKeys: [{ pubkey: wallet }],
            },
          },
        },
      }),
    } as unknown as Response);

    const result = await verifySolanaPayment(wallet, signature, fetchMock);

    expect(result.signature).toBe(signature);
    expect(result.amount).toBe(5);
    expect(fetchMock).toHaveBeenCalledWith(env.HELIUS_RPC_URL, expect.any(Object));
  });

  it('throws when wallet is not part of the transaction', async () => {
    const env = getEnv();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          slot: 12345,
          meta: {
            err: null,
            postTokenBalances: [
              {
                mint: env.USDC_MINT_ADDRESS,
                owner: 'another-wallet',
                uiTokenAmount: { uiAmount: 5 },
              },
            ],
          },
          transaction: {
            message: {
              accountKeys: [{ pubkey: 'another-wallet' }],
            },
          },
        },
      }),
    } as unknown as Response);

    await expect(verifySolanaPayment(wallet, signature, fetchMock)).rejects.toThrow(
      'Wallet address not present in transaction'
    );
  });

  it('throws when the RPC returns an error', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);

    await expect(verifySolanaPayment(wallet, signature, fetchMock)).rejects.toThrow(
      'Helius RPC request failed'
    );
  });
});

