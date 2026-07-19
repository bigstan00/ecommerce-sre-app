import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const USER_ID_HEADER = 'x-user-id';

/**
 * Trust boundary: per shared/CONTRACTS.md, the gateway is the only public
 * entry point and is responsible for verifying the caller's JWT and
 * injecting X-User-Id. This service trusts that header as-is and does not
 * re-verify identity. It must only be reachable from the gateway in a real
 * deployment (TODO: enforce via k8s NetworkPolicy).
 */
export async function requireUserId(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers[USER_ID_HEADER];
  const userId = Array.isArray(header) ? header[0] : header;

  if (!userId || userId.trim() === '') {
    await reply.status(401).send({ error: 'Missing required X-User-Id header' });
    return;
  }

  req.userId = userId;
}
