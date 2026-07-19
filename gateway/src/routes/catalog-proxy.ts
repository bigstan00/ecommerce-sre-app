import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { AppConfig } from '../config';

/**
 * `/api/products/*` and `/api/categories/*` -> CATALOG_SERVICE_URL.
 * Public browsing endpoints — no JWT required.
 */
const catalogProxyRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (fastify, opts) => {
  await fastify.register(httpProxy, {
    upstream: opts.config.catalogServiceUrl,
    prefix: '/api/products',
    rewritePrefix: '/products',
    http2: false,
  });

  await fastify.register(httpProxy, {
    upstream: opts.config.catalogServiceUrl,
    prefix: '/api/categories',
    rewritePrefix: '/categories',
    http2: false,
  });
};

export default catalogProxyRoutes;
