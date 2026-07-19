import type { FastifyInstance } from 'fastify';
import { requireUserId } from '../middleware/requireUserId';
import {
  addItem,
  clearCart,
  getCart,
  ProductNotFoundError,
  removeItem,
  updateItem,
  CatalogUnavailableError,
} from '../lib/cartService';
import { RedisUnavailableError } from '../lib/redisClient';
import type { AddItemBody, UpdateItemBody } from '../types/cart';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export async function cartRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUserId);

  app.get('/cart', async (req, reply) => {
    const result = await getCart(req.userId);
    return reply.status(200).send(result);
  });

  app.post<{ Body: AddItemBody }>('/cart/items', async (req, reply) => {
    const { productId, quantity } = req.body ?? ({} as AddItemBody);

    if (!isNonEmptyString(productId) || !isPositiveInteger(quantity)) {
      return reply.status(400).send({
        error: 'Body must include a non-empty "productId" and a positive integer "quantity"',
      });
    }

    try {
      const cart = await addItem(req.userId, productId, quantity);
      return reply.status(200).send({ cart });
    } catch (err) {
      if (err instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof CatalogUnavailableError) {
        return reply.status(502).send({ error: 'Catalog service is unavailable, try again later' });
      }
      throw err;
    }
  });

  app.put<{ Params: { productId: string }; Body: UpdateItemBody }>(
    '/cart/items/:productId',
    async (req, reply) => {
      const { productId } = req.params;
      const { quantity } = req.body ?? ({} as UpdateItemBody);

      if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
        return reply.status(400).send({ error: 'Body must include an integer "quantity"' });
      }

      try {
        const cart = await updateItem(req.userId, productId, quantity);
        return reply.status(200).send({ cart });
      } catch (err) {
        if (err instanceof ProductNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof CatalogUnavailableError) {
          return reply
            .status(502)
            .send({ error: 'Catalog service is unavailable, try again later' });
        }
        throw err;
      }
    }
  );

  app.delete<{ Params: { productId: string } }>('/cart/items/:productId', async (req, reply) => {
    const { productId } = req.params;
    const cart = await removeItem(req.userId, productId);
    return reply.status(200).send({ cart });
  });

  app.delete('/cart', async (req, reply) => {
    await clearCart(req.userId);
    return reply.status(204).send();
  });

  // Surface Redis outages as 503s instead of generic 500s, at the route level.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof RedisUnavailableError) {
      req.log.error({ err }, 'Redis unavailable while handling request');
      return reply.status(503).send({ error: 'Cart storage is temporarily unavailable' });
    }
    throw err;
  });
}
