import Fastify, { type FastifyError } from 'fastify';
import rateLimit, { type RateLimitPluginOptions, type errorResponseBuilderContext } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import type { AppConfig } from './config';
import type { Logger } from './logger';
import {
  classifyUpstream,
  httpRequestDurationSeconds,
  httpRequestErrorsTotal,
  httpRequestsTotal,
  rateLimitExceededTotal,
} from './metrics';
import authProxyRoutes from './routes/auth-proxy';
import catalogProxyRoutes from './routes/catalog-proxy';
import cartProxyRoutes from './routes/cart-proxy';
import orderProxyRoutes from './routes/order-proxy';
import adminProductsProxyRoutes from './routes/admin-products-proxy';
import adminInventoryProxyRoutes from './routes/admin-inventory-proxy';
import adminOrdersProxyRoutes from './routes/admin-orders-proxy';
import healthRoutes from './routes/health';

/**
 * Builds the shared pieces every rate-limit registration in this file uses:
 * the response shape (matches the rest of the gateway's error convention)
 * and the metrics/logging hook fired when a client gets throttled.
 *
 * `limiterName` only affects the `limiter` metric label and log line — it
 * has no bearing on which requests the limiter applies to.
 */
function rateLimitCommonOptions(limiterName: string): Pick<RateLimitPluginOptions, 'errorResponseBuilder' | 'onExceeded'> {
  return {
    // @fastify/rate-limit does `throw errorResponseBuilder(req, context)` verbatim
    // when a custom builder is supplied — it does NOT attach `.statusCode` for you
    // the way its own default builder does. Returning a plain `{error, message}`
    // object here means the gateway's central setErrorHandler (which reads
    // `error.statusCode` to pick a response code) can't tell this apart from an
    // unrecognized failure and falls back to 502. Building a real Error with
    // `.statusCode` set, mirroring the library's own default builder, is what
    // makes the central handler emit the correct 429.
    errorResponseBuilder: (_request: FastifyRequest, context: errorResponseBuilderContext) => {
      const error = new Error(`Rate limit exceeded, retry in ${context.after}`) as FastifyError;
      error.name = 'TooManyRequests';
      error.statusCode = context.statusCode;
      return error;
    },
    onExceeded: (request: FastifyRequest) => {
      rateLimitExceededTotal.inc({ upstream: classifyUpstream(request.url), limiter: limiterName });
      request.log.warn({ ip: request.ip, limiter: limiterName, url: request.url }, 'rate limit exceeded');
    },
  };
}

export function buildApp(config: AppConfig, logger: Logger) {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

  // Shared Redis connection for rate-limit counters. Unset RATE_LIMIT_REDIS_URL
  // means each rate limiter falls back to counting in this process's own
  // memory — correct for a single gateway instance, WRONG once you run
  // multiple replicas (see the comment on AppConfig.rateLimitRedisUrl).
  const rateLimitRedis = config.rateLimitRedisUrl ? new Redis(config.rateLimitRedisUrl) : undefined;

  // Per-request metrics, recorded once the response has been sent.
  app.addHook('onResponse', async (request, reply) => {
    const upstream = classifyUpstream(request.url);
    const route = request.routeOptions?.url ?? request.url;
    const statusCode = String(reply.statusCode);
    const labels = { method: request.method, upstream, route, status_code: statusCode };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, reply.elapsedTime / 1000);

    if (reply.statusCode >= 500) {
      httpRequestErrorsTotal.inc(labels);
    }
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    request.log.error({ err: error }, 'unhandled error while processing request');

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 502;
    httpRequestErrorsTotal.inc({
      method: request.method,
      upstream: classifyUpstream(request.url),
      route: request.routeOptions?.url ?? request.url,
      status_code: String(statusCode),
    });

    reply.code(statusCode).send({
      error: statusCode === 502 ? 'Bad Gateway' : error.name,
      message: statusCode === 502 ? 'Upstream service error' : error.message,
    });
  });

  // Global rate limit — applies to every route registered anywhere in this
  // app (Fastify hooks added at the root apply to the whole plugin tree).
  // /healthz, /readyz, /metrics opt themselves out individually via
  // `config: { rateLimit: false }` in health.ts — see the comment there for
  // why that's the mechanism, not `allowList` here. Health/metrics must stay
  // exempt: if your own health checks can get rate-limited, a burst of real
  // traffic can make Kubernetes see a failing probe and kill a healthy pod.
  app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    redis: rateLimitRedis,
    nameSpace: 'gw-rl-global:',
    ...rateLimitCommonOptions('global'),
  });

  app.register(healthRoutes, { config });

  // /api/auth/* gets a SECOND, stricter rate limit layered on top of the
  // global one, scoped to this nested plugin context only. This is Fastify
  // encapsulation, not a special feature of the rate-limit plugin: a hook
  // registered inside a child plugin only applies to routes registered in
  // that same child — so this stricter check runs in addition to (not
  // instead of) the global one, and only for auth traffic. Login/register
  // are the realistic brute-force target here, which is why this route
  // group — not cart or orders — gets the tighter number.
  app.register(async (authScope) => {
    await authScope.register(rateLimit, {
      max: config.rateLimitAuthMax,
      timeWindow: config.rateLimitAuthWindow,
      redis: rateLimitRedis,
      nameSpace: 'gw-rl-auth:',
      ...rateLimitCommonOptions('auth'),
    });
    await authScope.register(authProxyRoutes, { config });
  });

  app.register(catalogProxyRoutes, { config });

  // /api/cart/* and /api/orders/* share a THIRD rate limit, keyed by the
  // caller's user ID instead of IP — so people behind a shared/office IP
  // don't share one budget; one account maxing this out doesn't affect
  // anyone else on the same network. This one has to run at the
  // 'preHandler' stage, not the default 'onRequest': request.userId isn't
  // set until each route's own JWT preHandler has already run, and Fastify
  // appends preHandlers in registration order, so putting this rate limiter
  // in the same nested scope as cart/order routes makes its check run AFTER
  // the JWT check they already have — meaning an unauthenticated request
  // never reaches this limiter at all, it gets a 401 from the JWT check
  // first. Verified live rather than assumed, same as the other two.
  //
  // rateLimitUserMax MUST be lower than rateLimitMax (enforced at startup
  // by assertRateLimitInvariants in config.ts) — otherwise a single user
  // could exhaust the whole shared IP budget before this limiter ever
  // engages, which would defeat the reason it exists.
  app.register(async (userScope) => {
    await userScope.register(rateLimit, {
      max: config.rateLimitUserMax,
      timeWindow: config.rateLimitUserWindow,
      hook: 'preHandler',
      keyGenerator: (request) => request.userId ?? request.ip,
      redis: rateLimitRedis,
      nameSpace: 'gw-rl-user:',
      ...rateLimitCommonOptions('user'),
    });
    await userScope.register(cartProxyRoutes, { config });
    await userScope.register(orderProxyRoutes, { config });
  });

  app.register(adminProductsProxyRoutes, { config });
  app.register(adminInventoryProxyRoutes, { config });
  app.register(adminOrdersProxyRoutes, { config });

  return app;
}
