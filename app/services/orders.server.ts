import { fetchOrdersByCustomerId } from "./shopifyAdmin.server";

type ShopifyOrder = {
  id: number;
  admin_graphql_api_id?: string;
  name?: string;
  created_at?: string;
  total_price?: string;
  total_price_set?: {
    presentment_money?: {
      amount?: string;
      currency_code?: string;
    };
  };
  total_refunds?: string;
  currency?: string;
  customer?: {
    id?: number;
    email?: string;
    first_name?: string | null;
    last_name?: string | null;
  };
};

export type SimplifiedOrder = {
  id: string;
  gid: string;
  name: string;
  createdAt: string;
  total: number;
  currency: string;
  totalRefunds: number;
};

function normalizeAmount(value?: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function listOrdersForCustomer(
  customerId: string,
  shopDomain?: string | null,
  options?: { limit?: number },
): Promise<SimplifiedOrder[]> {
  const json = await fetchOrdersByCustomerId(customerId, shopDomain, options);
  const orders: ShopifyOrder[] = json.orders ?? [];

  return orders.map((order) => {
    const gid = order.admin_graphql_api_id ?? `gid://shopify/Order/${order.id}`;
    const presentmentAmount = order.total_price_set?.presentment_money?.amount;
    const currency =
      order.total_price_set?.presentment_money?.currency_code ??
      order.currency ??
      "EUR";

    return {
      id: String(order.id),
      gid,
      name: order.name ?? `Commande #${order.id}`,
      createdAt: order.created_at ?? new Date().toISOString(),
      total: normalizeAmount(presentmentAmount ?? order.total_price),
      currency,
      totalRefunds: normalizeAmount(order.total_refunds),
    };
  });
}

