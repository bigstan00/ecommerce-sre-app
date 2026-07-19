import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { AppConfig } from '../config';

/**
 * `/api/admin/inventory/*` -> INVENTORY_SERVICE_URL, stripping the
 * `/api/admin` prefix (so `/api/admin/inventory` -> `/inventory` upstream).
 * Inventory was Kafka-only before Phase 5 and was never proxied by the
 * gateway; this is the first synchronous route to it.
 * No JWT check here — admin routes are gated by `X-Admin-Token` instead, and
 * the gateway does not own that credential. It passes the header through
 * untouched and lets Inventory validate it (same "gateway doesn't own this
 * credential" pattern as `/api/auth/*`).
 */
const adminInventoryProxyRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (fastify, opts) => {
  await fastify.register(httpProxy, {
    upstream: opts.config.inventoryServiceUrl,
    prefix: '/api/admin/inventory',
    rewritePrefix: '/inventory',
    http2: false,
  });
};

export default adminInventoryProxyRoutes;
