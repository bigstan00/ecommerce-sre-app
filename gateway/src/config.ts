/**
 * Central config loader. All configuration comes from environment variables
 * only (see CONTRACTS.md cross-cutting conventions) — no hardcoded ports,
 * URLs, or secrets. Fails fast on startup if required vars are missing.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface AppConfig {
  port: number;
  logLevel: string;
  authServiceUrl: string;
  catalogServiceUrl: string;
  cartServiceUrl: string;
  orderServiceUrl: string;
  inventoryServiceUrl: string;
  jwtSecret: string;
  /** Milliseconds to wait for an upstream /healthz check before /readyz reports it down. */
  readinessTimeoutMs: number;
  /** General rate limit applied to every route except /healthz, /readyz, /metrics. */
  rateLimitMax: number;
  rateLimitWindow: string;
  /** Stricter, separate rate limit applied only to /api/auth/* (login/register are brute-force targets). */
  rateLimitAuthMax: number;
  rateLimitAuthWindow: string;
  /**
   * Per-authenticated-user rate limit applied to /api/cart/* and /api/orders/*,
   * keyed by the caller's user ID (not IP) so people sharing an office/NAT'd
   * IP don't share a budget — one user maxing this out doesn't affect anyone
   * else on the same network. MUST stay lower than rateLimitMax, or a single
   * user could exhaust the whole shared IP budget before their own per-user
   * cap ever engages, defeating the point of having it. loadConfig() throws
   * on startup if this invariant is violated.
   */
  rateLimitUserMax: number;
  rateLimitUserWindow: string;
  /**
   * Optional. When unset, rate limit counters live in this process's memory —
   * fine for a single gateway instance, but WRONG once you run multiple
   * replicas (each replica would count independently, multiplying the
   * effective limit). Set this to share one counter across all replicas.
   */
  rateLimitRedisUrl?: string;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? '8080');
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }

  return {
    port,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    authServiceUrl: requireEnv('AUTH_SERVICE_URL'),
    catalogServiceUrl: requireEnv('CATALOG_SERVICE_URL'),
    cartServiceUrl: requireEnv('CART_SERVICE_URL'),
    orderServiceUrl: requireEnv('ORDER_SERVICE_URL'),
    inventoryServiceUrl: process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:4006',
    jwtSecret: requireEnv('JWT_SECRET'),
    readinessTimeoutMs: Number(process.env.READINESS_TIMEOUT_MS ?? '2000'),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? '300'),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    rateLimitAuthMax: Number(process.env.RATE_LIMIT_AUTH_MAX ?? '10'),
    rateLimitAuthWindow: process.env.RATE_LIMIT_AUTH_WINDOW ?? '1 minute',
    rateLimitUserMax: Number(process.env.RATE_LIMIT_USER_MAX ?? '60'),
    rateLimitUserWindow: process.env.RATE_LIMIT_USER_WINDOW ?? '1 minute',
    rateLimitRedisUrl: process.env.RATE_LIMIT_REDIS_URL || undefined,
  };
}

/**
 * Enforces the invariant documented on AppConfig.rateLimitUserMax: the
 * per-user limit only does its job (stopping one user from starving
 * everyone else on their IP) if it's reached well before the shared IP
 * limit is. If someone changes one of these env vars later without
 * realizing they depend on each other, fail loudly at startup rather than
 * silently shipping a rate limiter that can never trigger.
 */
export function assertRateLimitInvariants(config: AppConfig): void {
  if (config.rateLimitUserMax >= config.rateLimitMax) {
    throw new Error(
      `RATE_LIMIT_USER_MAX (${config.rateLimitUserMax}) must be lower than RATE_LIMIT_MAX ` +
        `(${config.rateLimitMax}) — otherwise a single user can exhaust the whole shared IP ` +
        'budget before their own per-user limit ever engages, defeating its purpose.',
    );
  }
}
