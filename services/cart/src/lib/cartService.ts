import { redisClient } from './redisClient';
import { fetchProduct, CatalogUnavailableError } from './catalogClient';
import type { Cart, CartItem, CartResponse } from '../types/cart';

export class ProductNotFoundError extends Error {
  constructor(productId: string) {
    super(`Product ${productId} not found`);
    this.name = 'ProductNotFoundError';
  }
}

function emptyCart(): Cart {
  return { items: [], updatedAt: new Date().toISOString() };
}

async function readCart(userId: string): Promise<Cart> {
  const raw = await redisClient.getCart(userId);
  if (!raw) return emptyCart();
  try {
    const parsed = JSON.parse(raw) as Cart;
    if (!Array.isArray(parsed.items)) return emptyCart();
    return parsed;
  } catch {
    // Corrupt data shouldn't crash the service — treat as an empty cart.
    return emptyCart();
  }
}

async function writeCart(userId: string, cart: Cart): Promise<Cart> {
  const toStore: Cart = { items: cart.items, updatedAt: new Date().toISOString() };
  await redisClient.setCart(userId, JSON.stringify(toStore));
  return toStore;
}

function toResponse(cart: Cart): CartResponse {
  const total = cart.items.reduce((sum, item) => sum + item.priceSnapshot * item.quantity, 0);
  return { items: cart.items, total: Math.round(total * 100) / 100 };
}

export async function getCart(userId: string): Promise<CartResponse> {
  const cart = await readCart(userId);
  return toResponse(cart);
}

export async function addItem(
  userId: string,
  productId: string,
  quantity: number
): Promise<CartResponse> {
  const product = await fetchProduct(productId);
  if (!product) {
    throw new ProductNotFoundError(productId);
  }

  const cart = await readCart(userId);
  const existing = cart.items.find((item) => item.productId === productId);

  if (existing) {
    existing.quantity += quantity;
    existing.priceSnapshot = product.price;
  } else {
    const newItem: CartItem = { productId, quantity, priceSnapshot: product.price };
    cart.items.push(newItem);
  }

  const saved = await writeCart(userId, cart);
  return toResponse(saved);
}

export async function updateItem(
  userId: string,
  productId: string,
  quantity: number
): Promise<CartResponse> {
  const cart = await readCart(userId);

  if (quantity <= 0) {
    cart.items = cart.items.filter((item) => item.productId !== productId);
  } else {
    const existing = cart.items.find((item) => item.productId === productId);
    if (existing) {
      existing.quantity = quantity;
    } else {
      // Item isn't in the cart yet — validate against Catalog before adding,
      // same as addItem, so PUT can also be used to (re)create an item.
      const product = await fetchProduct(productId);
      if (!product) {
        throw new ProductNotFoundError(productId);
      }
      cart.items.push({ productId, quantity, priceSnapshot: product.price });
    }
  }

  const saved = await writeCart(userId, cart);
  return toResponse(saved);
}

export async function removeItem(userId: string, productId: string): Promise<CartResponse> {
  const cart = await readCart(userId);
  cart.items = cart.items.filter((item) => item.productId !== productId);
  const saved = await writeCart(userId, cart);
  return toResponse(saved);
}

export async function clearCart(userId: string): Promise<void> {
  await redisClient.deleteCart(userId);
}

export { CatalogUnavailableError };
