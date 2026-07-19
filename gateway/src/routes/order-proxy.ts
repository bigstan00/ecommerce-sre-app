import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { AppConfig } from '../config';
import { createJwtPreHandler } from '../plugins/auth';

/**
 * `/api/orders/*` -> ORDER_SERVICE_URL.
 * Requires a valid `Authorization: Bearer <token>` header (verified against
 * JWT_SECRET, HS256). On success the caller's `sub` claim is injected as
 * `X-User-Id` on the forwarded request. 401 on missing/invalid/expired token.
 */
const orderProxyRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (fastify, opts) => {
  await fastify.register(httpProxy, {
    upstream: opts.config.orderServiceUrl,
    prefix: '/api/orders',
    rewritePrefix: '/orders',
    http2: false,
    preHandler: createJwtPreHandler(opts.config.jwtSecret),
    replyOptions: {
      rewriteRequestHeaders: (originalReq, headers) => ({
        ...headers,
        'x-user-id': originalReq.userId ?? '',
      }),
    },
  });
};

export default orderProxyRoutes;
