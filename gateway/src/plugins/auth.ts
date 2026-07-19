import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new AuthError('Missing Authorization header');
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AuthError('Authorization header must be in the form "Bearer <token>"');
  }
  return token;
}

/**
 * Builds a preHandler that verifies the caller's JWT against JWT_SECRET
 * (HS256) and, on success, stashes the `sub` claim on `request.userId` so
 * the cart proxy can inject it as `X-User-Id` on the forwarded request.
 *
 * Returns 401 on any missing/invalid/expired token, per CONTRACTS.md.
 */
export function createJwtPreHandler(jwtSecret: string) {
  return async function jwtPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const token = extractBearerToken(request.headers.authorization);
      const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });

      if (typeof decoded === 'string' || !decoded.sub) {
        throw new AuthError('Token payload missing "sub" claim');
      }

      request.userId = String(decoded.sub);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'invalid token';
      request.log.warn({ reason }, 'jwt verification failed');
      await reply.code(401).send({ error: 'Unauthorized', message: 'Missing, invalid, or expired token' });
    }
  };
}
