// Typed client for the API gateway. This is the ONLY place in the app that
// should call `fetch()` against the backend — every page/component should go
// through these functions so the request/response shapes stay in one place
// and match shared/CONTRACTS.md exactly.

import type {
  Cart,
  CategoryListResponse,
  CreateOrderResponse,
  LoginRequest,
  LoginResponse,
  Me,
  Order,
  Product,
  ProductListResponse,
  RegisterRequest,
  RegisterResponse,
} from "./types";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  cache?: RequestCache;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, cache = "no-store" } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache,
    });
  } catch (err) {
    // Network-level failure (gateway unreachable, DNS, connection refused, etc).
    throw new ApiError(
      `Could not reach the API gateway at ${getBaseUrl()}${path}. Is the gateway running?`,
      0,
      err
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? safeJsonParse(text) : undefined;

  if (!res.ok) {
    const message = extractMessage(data) || `Request to ${path} failed with status ${res.status}`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

function extractMessage(data: unknown): string | undefined {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Normalizes a raw product payload (Mongo may surface `_id` instead of `id`). */
function normalizeProduct(raw: any): Product {
  return {
    id: String(raw.id ?? raw._id),
    name: raw.name,
    description: raw.description,
    price: raw.price,
    category: raw.category,
    imageUrl: raw.imageUrl,
    stock: raw.stock,
    createdAt: raw.createdAt,
  };
}

// ---------- Catalog ----------

export interface GetProductsParams {
  category?: string;
  page?: number;
  limit?: number;
}

export async function getProducts(params: GetProductsParams = {}): Promise<ProductListResponse> {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const data = await request<any>(`/products${qs ? `?${qs}` : ""}`);
  return {
    items: (data.items ?? []).map(normalizeProduct),
    total: data.total ?? 0,
    page: data.page ?? params.page ?? 1,
    limit: data.limit ?? params.limit ?? 12,
  };
}

export async function getProduct(id: string): Promise<Product | null> {
  try {
    const data = await request<any>(`/products/${id}`);
    const raw = data.product ?? data;
    return normalizeProduct(raw);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function getCategories(): Promise<string[]> {
  const data = await request<CategoryListResponse>("/categories");
  return data.categories ?? [];
}

// ---------- Auth ----------

export async function register(payload: RegisterRequest): Promise<RegisterResponse> {
  return request<RegisterResponse>("/auth/register", { method: "POST", body: payload });
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", { method: "POST", body: payload });
}

export async function getMe(token: string): Promise<Me> {
  return request<Me>("/auth/me", { token });
}

export async function logout(token: string): Promise<void> {
  await request<void>("/auth/logout", { method: "POST", token });
}

// ---------- Cart ----------

function normalizeCart(raw: any): Cart {
  return {
    items: raw.items ?? [],
    total: raw.total ?? 0,
    updatedAt: raw.updatedAt,
  };
}

export async function getCart(token: string): Promise<Cart> {
  const data = await request<any>("/cart", { token });
  return normalizeCart(data);
}

export async function addCartItem(
  token: string,
  productId: string,
  quantity: number
): Promise<Cart> {
  const data = await request<any>("/cart/items", {
    method: "POST",
    token,
    body: { productId, quantity },
  });
  return normalizeCart(data.cart ?? data);
}

export async function updateCartItem(
  token: string,
  productId: string,
  quantity: number
): Promise<Cart> {
  const data = await request<any>(`/cart/items/${productId}`, {
    method: "PUT",
    token,
    body: { quantity },
  });
  return normalizeCart(data.cart ?? data);
}

export async function removeCartItem(token: string, productId: string): Promise<Cart> {
  const data = await request<any>(`/cart/items/${productId}`, {
    method: "DELETE",
    token,
  });
  return normalizeCart(data.cart ?? data);
}

export async function clearCart(token: string): Promise<void> {
  await request<void>("/cart", { method: "DELETE", token });
}

// ---------- Orders (Phase 2) ----------

/** Normalizes a raw order payload (tolerates snake_case item fields from the Go service). */
function normalizeOrder(raw: any): Order {
  return {
    orderId: String(raw.orderId ?? raw.id),
    status: raw.status,
    totalAmount: raw.totalAmount ?? 0,
    cancelReason: raw.cancelReason ?? null,
    items: (raw.items ?? []).map((item: any) => ({
      productId: String(item.productId ?? item.product_id),
      quantity: item.quantity,
      priceSnapshot: item.priceSnapshot ?? item.price_snapshot,
    })),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** Places an order from the caller's current cart. Empty body — the Order service reads the cart itself. */
export async function createOrder(token: string): Promise<CreateOrderResponse> {
  const data = await request<any>("/orders", { method: "POST", token });
  return { orderId: String(data.orderId), status: data.status };
}

export async function getOrder(token: string, orderId: string): Promise<Order | null> {
  try {
    const data = await request<any>(`/orders/${orderId}`, { token });
    return normalizeOrder(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function getOrders(token: string): Promise<Order[]> {
  const data = await request<any>("/orders", { token });
  return (data.orders ?? []).map(normalizeOrder);
}
