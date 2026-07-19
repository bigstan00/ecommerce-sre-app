import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import type { AppConfig } from '../config';

/**
 * `/api/auth/*` -> AUTH_SERVICE_URL, stripping the `/api` prefix.
 * No JWT check here — these are the auth endpoints themselves, including
 * `/api/auth/me` which passes the client's own bearer token straight
 * through untouched (no header injection needed).
 */
const authProxyRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (fastify, opts) => {
  await fastify.register(httpProxy, {
    upstream: opts.config.authServiceUrl,
    prefix: '/api/auth',
    rewritePrefix: '/auth',
    http2: false,
  });
};

export default authProxyRoutes;
