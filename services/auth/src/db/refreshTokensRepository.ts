import { createHash } from 'crypto';
import { pool } from './pool';

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export async function storeRefreshToken(params: {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [params.userId, hashToken(params.rawToken), params.expiresAt],
  );
}

export async function findActiveRefreshToken(rawToken: string): Promise<RefreshTokenRow | null> {
  const { rows } = await pool.query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
     FROM refresh_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [hashToken(rawToken)],
  );
  return rows[0] ?? null;
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
