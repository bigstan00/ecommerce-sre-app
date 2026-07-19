// Typed client for the API gateway. This is the ONLY place in the app that
// should call `fetch()` against the backend — every page/component should go
// through these functions so the request/response shapes stay in one place
// and match shared/CONTRACTS.md exactly.

import type {
  AdminOrder,
  AdminOrderListResponse,
  CreateProductRequest,
  CreateProductResponse,
  InventoryItem,
  InventoryListResponse,
  Product,
  ProductListResponse,
  UpsertInventoryRequest,
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
  /** Admin static token, sent as `X-Admin-Token` (not a bearer JWT). */
  adminToken?: string | null;
  cache?: RequestCache;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, adminToken, cache = "no-store" } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (adminToken) {
    headers["X-Admin-Token"] = adminToken;
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

function normalizeInventoryItem(raw: any): InventoryItem {
  return {
    productId: String(raw.productId ?? raw.product_id),
    available: raw.available,
    updatedAt: raw.updatedAt ?? raw.updated_at,
  };
}

function normalizeAdminOrder(raw: any): AdminOrder {
  return {
    orderId: String(raw.orderId ?? raw.id),
    userId: String(raw.userId ?? raw.user_id),
    status: raw.status,
    totalAmount: raw.totalAmount ?? 0,
    cancelReason: raw.cancelReason ?? null,
    createdAt: raw.createdAt,
  };
}

// ---------- Catalog (public reads — no admin token required) ----------

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
    limit: data.limit ?? params.limit ?? 20,
  };
}

/** `POST /api/admin/products` — creates a product. Requires the admin token. */
export async function createProduct(
  token: string,
  payload: CreateProductRequest
): Promise<CreateProductResponse> {
  const data = await request<any>("/admin/products", {
    method: "POST",
    adminToken: token,
    body: payload,
  });
  return { id: String(data.id) };
}

// ---------- Inventory (admin-token gated) ----------

export interface GetInventoryParams {
  page?: number;
  limit?: number;
}

export async function getInventory(
  token: string,
  params: GetInventoryParams = {}
): Promise<InventoryListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const data = await request<any>(`/admin/inventory${qs ? `?${qs}` : ""}`, {
    adminToken: token,
  });
  return {
    items: (data.items ?? []).map(normalizeInventoryItem),
    total: data.total ?? 0,
    page: data.page ?? params.page ?? 1,
    limit: data.limit ?? params.limit ?? 20,
  };
}

/** `POST /api/admin/inventory` — upserts stock for a product. Requires the admin token. */
export async function upsertInventory(
  token: string,
  payload: UpsertInventoryRequest
): Promise<void> {
  await request<any>("/admin/inventory", {
    method: "POST",
    adminToken: token,
    body: payload,
  });
}

/**
 * Verifies an admin token by calling a lightweight admin-gated endpoint and
 * checking for a non-403 response, per shared/CONTRACTS.md's Phase 5 login
 * spec. A 403 means the token is definitively wrong. Any other outcome
 * (success, or the gateway/downstream being unreachable) is treated as
 * "not proven invalid" — we don't want a transient backend outage to block
 * someone from storing a token that may well be correct; other pages will
 * still surface their own error states if the backend stays down.
 */
export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    await request<any>("/admin/inventory?limit=1", { adminToken: token });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return false;
    }
    return true;
  }
}

// ---------- Orders (admin-token gated, across all users) ----------

export interface GetAdminOrdersParams {
  page?: number;
  limit?: number;
  status?: string;
}

export async function getAdminOrders(
  token: string,
  params: GetAdminOrdersParams = {}
): Promise<AdminOrderListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  if (params.status) search.set("status", params.status);
  const qs = search.toString();
  const data = await request<any>(`/admin/orders${qs ? `?${qs}` : ""}`, {
    adminToken: token,
  });
  return {
    orders: (data.orders ?? []).map(normalizeAdminOrder),
    total: data.total ?? 0,
    page: data.page ?? params.page ?? 1,
    limit: data.limit ?? params.limit ?? 20,
  };
}
