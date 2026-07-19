export interface CartItem {
  productId: string;
  quantity: number;
  priceSnapshot: number;
}

export interface Cart {
  items: CartItem[];
  updatedAt: string;
}

export interface CartResponse {
  items: CartItem[];
  total: number;
}

export interface AddItemBody {
  productId: string;
  quantity: number;
}

export interface UpdateItemBody {
  quantity: number;
}

export interface CatalogProduct {
  id?: string;
  _id?: string;
  name: string;
  price: number;
  [key: string]: unknown;
}

export interface CatalogProductResponse {
  product: CatalogProduct;
}
