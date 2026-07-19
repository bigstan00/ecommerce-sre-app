import { randomBytes } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

/**
 * Signs a short-lived access token. `sub` carries the user id, matching the
 * gateway's expectation (it forwards `sub` as `X-User-Id`).
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: config.accessTokenTtl as SignOptions['expiresIn'],
    algorithm: 'HS256',
  };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded.sub || !decoded.email) {
    throw new Error('malformed access token payload');
  }
  return { sub: String(decoded.sub), email: String(decoded.email) };
}

/** Opaque random refresh token — not a JWT, validated against the DB. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

/** Returns seconds-until-expiry for the configured access token TTL. */
export function accessTokenExpiresInSeconds(): number {
  return parseDurationToSeconds(config.accessTokenTtl);
}

export function refreshTokenExpiryDate(): Date {
  const seconds = parseDurationToSeconds(config.refreshTokenTtl);
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Parses simple duration strings like "15m", "7d", "3600s", or a bare
 * number of seconds (e.g. "900") — enough to cover ACCESS_TOKEN_TTL /
 * REFRESH_TOKEN_TTL as documented in .env.example.
 */
function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
}
