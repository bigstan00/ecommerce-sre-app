// Shared domain types mirrored from shared/CONTRACTS.md ("Phase 5: admin
// dashboard" section). Keep these in sync with the contract document — do
// not improvise field names.

// ---------- Catalog (public reads, same shape as the storefront) ----------

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  stock: number;
  createdAt: string;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateProductRequest {
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  stock: number;
}

export interface CreateProductResponse {
  id: string;
}

// ---------- Inventory (admin-token gated) ----------

export interface InventoryItem {
  productId: string;
  available: number;
  updatedAt: string;
}

export interface InventoryListResponse {
  items: InventoryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface UpsertInventoryRequest {
  productId: string;
  available: number;
}

// ---------- Orders (admin-token gated, all users) ----------

export type OrderStatus = "pending" | "inventory_reserved" | "confirmed" | "cancelled";

export interface AdminOrder {
  orderId: string;
  userId: string;
  status: OrderStatus;
  totalAmount: number;
  cancelReason?: string | null;
  createdAt: string;
}

export interface AdminOrderListResponse {
  orders: AdminOrder[];
  total: number;
  page: number;
  limit: number;
}
