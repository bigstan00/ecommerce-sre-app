import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { AppConfig } from '../config';

/**
 * `/api/admin/products/*` -> CATALOG_SERVICE_URL, stripping the `/api/admin`
 * prefix (so `/api/admin/products` -> `/products` upstream).
 * No JWT check here — admin routes are gated by `X-Admin-Token` instead, and
 * the gateway does not own that credential. It passes the header through
 * untouched and lets Catalog validate it (same "gateway doesn't own this
 * credential" pattern as `/api/auth/*`).
 */
const adminProductsProxyRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (fastify, opts) => {
  await fastify.register(httpProxy, {
    upstream: opts.config.catalogServiceUrl,
    prefix: '/api/admin/products',
    rewritePrefix: '/products',
    http2: false,
  });
};

export default adminProductsProxyRoutes;
