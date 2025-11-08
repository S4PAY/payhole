import { daysRemaining, issueUnlockToken, verifyUnlockToken } from '@/services/auth';

describe('auth service', () => {
  const wallet = 'wallet123';
  const now = new Date('2024-01-01T00:00:00.000Z');

  it('issues a JWT with 30 day expiry', () => {
    const { token, expiresAt } = issueUnlockToken(wallet, now);

    expect(token).toBeDefined();
    const diffMs = expiresAt.getTime() - now.getTime();
    expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('verifies token payload and extracts wallet', () => {
    const { token } = issueUnlockToken(wallet, now);
    const payload = verifyUnlockToken(token);

    expect(payload.wallet).toBe(wallet);
  });

  it('computes remaining days until expiration', () => {
    const expiresAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const remaining = daysRemaining(expiresAt, now);
    expect(remaining).toBe(5);
  });

  it('returns zero remaining days when expired', () => {
    const expiresAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const remaining = daysRemaining(expiresAt, now);
    expect(remaining).toBe(0);
  });
});

