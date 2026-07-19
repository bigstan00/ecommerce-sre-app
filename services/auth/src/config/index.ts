import 'dotenv/config';

interface Config {
  service: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtl: string;
  logLevel: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): Config {
  const port = Number(process.env.PORT ?? '4001');
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }

  return {
    service: 'auth',
    port,
    databaseUrl: requireEnv('DATABASE_URL'),
    jwtSecret: requireEnv('JWT_SECRET'),
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '7d',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

export const config = loadConfig();
