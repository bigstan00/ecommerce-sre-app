import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { AppConfig } from '../config';

/**
 * `/api/admin/orders/*` -> ORDER_SERVICE_URL, stripping only the `/api`
 * prefix (the `/admin` segment is kept, so `/api/admin/orders` ->
 * `/admin/orders` upstream — distinct from the customer-scoped
 * `/api/orders/*` route, which strips `/api` and hits plain `/orders`).
 * No JWT check here — admin routes are gated by `X-Admin-Token` instead, and
 * the gateway does not own that credential. It passes the header through
 * untouched and lets Order validate it (same "gateway doesn't own this
 * credential" pattern as `/api/auth/*`).
 */
const adminOrdersProxyRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (fastify, opts) => {
  await fastify.register(httpProxy, {
    upstream: opts.config.orderServiceUrl,
    prefix: '/api/admin/orders',
    rewritePrefix: '/admin/orders',
    http2: false,
  });
};

export default adminOrdersProxyRoutes;
