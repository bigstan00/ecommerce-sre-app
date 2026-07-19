function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(requireEnv('PORT', '4003'), 10),
  redisUrl: requireEnv('REDIS_URL', 'redis://localhost:6379'),
  catalogServiceUrl: requireEnv('CATALOG_SERVICE_URL', 'http://localhost:4002'),
  serviceName: 'cart',
} as const;
