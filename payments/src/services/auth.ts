import jwt from 'jsonwebtoken';
import { getEnv } from '@/config/env';

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

export type UnlockTokenPayload = {
  wallet: string;
};

export type UnlockTokenResult = {
  token: string;
  expiresAt: Date;
};

export function issueUnlockToken(wallet: string, issuedAt: Date = new Date()): UnlockTokenResult {
  const { JWT_SECRET } = getEnv();

  const expiresAt = new Date(issuedAt.getTime() + THIRTY_DAYS_IN_MS);
  const token = jwt.sign(
    { wallet },
    JWT_SECRET,
    {
      expiresIn: Math.floor(THIRTY_DAYS_IN_MS / 1000),
      issuer: 'payhole-payments',
      subject: wallet,
    }
  );

  return { token, expiresAt };
}

export function verifyUnlockToken(token: string): UnlockTokenPayload {
  const { JWT_SECRET } = getEnv();
  const decoded = jwt.verify(token, JWT_SECRET);

  if (typeof decoded === 'string' || !('wallet' in decoded)) {
    throw new Error('Invalid token payload');
  }

  return { wallet: decoded.wallet as string };
}

export function daysRemaining(expiresAt: Date, now: Date = new Date()): number {
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function tokenExpiryDateFromSeconds(exp: number): Date {
  return new Date(exp * 1000);
}

