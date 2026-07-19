// Shared domain types mirrored from shared/CONTRACTS.md.
// Keep these in sync with the contract document — do not improvise field names.

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

export interface CategoryListResponse {
  categories: string[];
}

export interface CartItem {
  productId: string;
  quantity: number;
  priceSnapshot: number;
  // Enriched client-side only, when we can resolve product details for display.
  product?: Pick<Product, "name" | "imageUrl">;
}

export interface Cart {
  items: CartItem[];
  total: number;
  updatedAt?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  userId: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Me {
  userId: string;
  email: string;
  name: string;
}

// ---------- Orders (Phase 2) ----------

export type OrderStatus = "pending" | "inventory_reserved" | "confirmed" | "cancelled";

export interface OrderItem {
  productId: string;
  quantity: number;
  priceSnapshot: number;
}

export interface Order {
  orderId: string;
  status: OrderStatus;
  totalAmount: number;
  cancelReason?: string | null;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderResponse {
  orderId: string;
  status: OrderStatus;
}

export interface OrderListResponse {
  orders: Order[];
}
