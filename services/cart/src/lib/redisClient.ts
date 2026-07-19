import { createClient, type RedisClientType } from 'redis';
import { config } from '../config';
import { logger } from './logger';

const CART_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class RedisUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Redis is unavailable');
    this.name = 'RedisUnavailableError';
    if (cause) this.cause = cause;
  }
}

class CartRedisClient {
  private client: RedisClientType;
  private connected = false;

  constructor() {
    this.client = createClient({
      url: config.redisUrl,
      // Fail fast instead of queuing commands indefinitely while
      // disconnected — without this, calls like ping()/get()/set() would
      // hang forever (rather than reject) whenever Redis is unreachable,
      // since the reconnect strategy below never gives up.
      disableOfflineQueue: true,
      socket: {
        // Retry with capped exponential backoff instead of giving up —
        // Redis may come up after this service does (e.g. in Compose/k8s).
        reconnectStrategy: (retries: number) => Math.min(retries * 100, 5000),
      },
    });

    this.client.on('error', (err) => {
      this.connected = false;
      logger.error({ err }, 'Redis client error');
    });

    this.client.on('connect', () => {
      logger.info('Redis client connecting');
    });

    this.client.on('ready', () => {
      this.connected = true;
      logger.info('Redis client ready');
    });

    this.client.on('end', () => {
      this.connected = false;
      logger.warn('Redis client connection closed');
    });
  }

  async connect(): Promise<void> {
    if (this.client.isOpen) return;
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  isReady(): boolean {
    return this.connected && this.client.isReady;
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping();
      return reply === 'PONG';
    } catch (err) {
      logger.error({ err }, 'Redis ping failed');
      return false;
    }
  }

  private key(userId: string): string {
    return `cart:${userId}`;
  }

  async getCart(userId: string): Promise<string | null> {
    this.assertReady();
    try {
      return await this.client.get(this.key(userId));
    } catch (err) {
      throw new RedisUnavailableError(err);
    }
  }

  async setCart(userId: string, value: string): Promise<void> {
    this.assertReady();
    try {
      await this.client.set(this.key(userId), value, { EX: CART_TTL_SECONDS });
    } catch (err) {
      throw new RedisUnavailableError(err);
    }
  }

  async deleteCart(userId: string): Promise<void> {
    this.assertReady();
    try {
      await this.client.del(this.key(userId));
    } catch (err) {
      throw new RedisUnavailableError(err);
    }
  }

  private assertReady(): void {
    if (!this.isReady()) {
      throw new RedisUnavailableError(new Error('Redis client is not connected'));
    }
  }
}

export const redisClient = new CartRedisClient();
