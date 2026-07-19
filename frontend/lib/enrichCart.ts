import { getProduct } from "./api";
import type { CartItem } from "./types";

/**
 * Cart items from the Cart service only carry productId/quantity/priceSnapshot
 * (see shared/CONTRACTS.md). For display we best-effort look up each
 * product's name/image from the Catalog service. If a lookup fails (product
 * deleted, catalog briefly down, etc) we fall back to showing the raw id
 * rather than failing the whole page.
 */
export async function enrichCartItems(items: CartItem[]): Promise<CartItem[]> {
  const results = await Promise.allSettled(items.map((item) => getProduct(item.productId)));
  return items.map((item, i) => {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      return {
        ...item,
        product: { name: result.value.name, imageUrl: result.value.imageUrl },
      };
    }
    return item;
  });
}
