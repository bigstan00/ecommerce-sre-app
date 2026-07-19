import { config } from '../config';
import { logger } from './logger';
import type { CatalogProduct, CatalogProductResponse } from '../types/cart';

export class CatalogUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Catalog service is unreachable');
    this.name = 'CatalogUnavailableError';
    if (cause) this.cause = cause;
  }
}

const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch a product from the Catalog service by id.
 * Returns null if the product does not exist (404).
 * Throws CatalogUnavailableError if Catalog cannot be reached or
 * returns an unexpected error status.
 */
export async function fetchProduct(productId: string): Promise<CatalogProduct | null> {
  const url = `${config.catalogServiceUrl}/products/${encodeURIComponent(productId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      logger.error({ status: res.status, url }, 'Catalog service returned an error status');
      throw new CatalogUnavailableError(new Error(`Catalog responded with status ${res.status}`));
    }

    const body = (await res.json()) as CatalogProductResponse;
    if (!body || typeof body !== 'object' || !body.product) {
      throw new CatalogUnavailableError(new Error('Catalog response missing "product" field'));
    }

    return body.product;
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      throw err;
    }
    logger.error({ err, url }, 'Failed to reach Catalog service');
    throw new CatalogUnavailableError(err);
  } finally {
    clearTimeout(timeout);
  }
}
