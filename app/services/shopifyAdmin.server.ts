import prisma from "app/db.server";

import { apiVersion } from "app/shopify.server";

type GraphqlRequest = {
  query: string;
  variables?: Record<string, unknown>;
  shopDomain?: string | null;
};

export type ShopifyAdminSession = {
  shop: string;
  accessToken: string;
};

const SHOP_DOMAIN_ENV_KEYS = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_STORE_URL", "SHOPIFY_SHOP_DOMAIN"] as const;

function inferShopDomain(): string | null {
  for (const key of SHOP_DOMAIN_ENV_KEYS) {
    const value = process.env[key];
    if (value) return value;
  }
  return null;
}

export async function getAdminSession(explicitShopDomain?: string | null): Promise<ShopifyAdminSession> {
  const shopDomain = explicitShopDomain ?? inferShopDomain();

  if (!shopDomain) {
    throw new Error("Aucun shop Shopify n'a été trouvé. Définis SHOPIFY_STORE_DOMAIN ou passe le domaine explicitement.");
  }

  const session = await prisma.session.findFirst({
    where: { shop: shopDomain },
  });

  if (!session) {
    throw new Error(`Aucune session Shopify active trouvée pour le shop ${shopDomain}`);
  }

  return {
    shop: session.shop,
    accessToken: session.accessToken,
  };
}

function buildGraphqlEndpoint(shop: string) {
  return `https://${shop}/admin/api/${apiVersion}/graphql.json`;
}

export async function callAdminGraphql<T = any>({ query, variables = {}, shopDomain }: GraphqlRequest): Promise<T> {
  const { shop, accessToken } = await getAdminSession(shopDomain);

  const response = await fetch(buildGraphqlEndpoint(shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Appel GraphQL Shopify échoué (${response.status}) : ${body}`);
  }

  return response.json();
}

export async function fetchOrderById(orderId: string, shopDomain?: string | null) {
  const { shop, accessToken } = await getAdminSession(shopDomain);
  const endpoint = `https://${shop}/admin/api/${apiVersion}/orders/${orderId}.json`;

  const response = await fetch(endpoint, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Récupération de la commande ${orderId} impossible (${response.status}) : ${body}`);
  }

  return response.json();
}

export async function fetchOrdersByCustomerId(
  customerId: string,
  shopDomain?: string | null,
  opts?: { limit?: number },
) {
  const { shop, accessToken } = await getAdminSession(shopDomain);
  const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 50);
  const endpoint = `https://${shop}/admin/api/${apiVersion}/orders.json?customer_id=${customerId}&status=any&limit=${limit}&order=created_at desc`;

  const response = await fetch(endpoint, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Impossible de récupérer les commandes du client ${customerId} (${response.status}) : ${body}`);
  }

  return response.json();
}

export async function getOrderTransactionParentId(orderGid: string, shopDomain?: string | null): Promise<string | null> {
  const query = `
    query GetOrderTransactions($orderId: ID!) {
      order(id: $orderId) {
        transactions(first: 10) {
          edges {
            node {
              id
              kind
              status
            }
          }
        }
      }
    }
  `;

  try {
    const response = await callAdminGraphql<{ data?: { order?: { transactions?: { edges?: Array<{ node?: { id?: string; kind?: string; status?: string } }> } } } }>({
      query,
      variables: { orderId: orderGid },
      shopDomain,
    });

    const transactions = response.data?.order?.transactions?.edges || [];
    
    // Chercher une transaction de type CAPTURE ou SALE qui est SUCCESS (pas un refund)
    const validTransaction = transactions.find((edge) => {
      const node = edge?.node;
      return node && 
             (node.kind === "CAPTURE" || node.kind === "SALE") && 
             node.status === "SUCCESS";
    });

    return validTransaction?.node?.id ?? transactions[0]?.node?.id ?? null;
  } catch (error) {
    console.error("Erreur lors de la récupération des transactions:", error);
    return null;
  }
}

export async function getOrderTotalAmount(orderGid: string, shopDomain?: string | null): Promise<number | null> {
  const query = `
    query GetOrderTotal($orderId: ID!) {
      order(id: $orderId) {
        totalPriceSet {
          presentmentMoney {
            amount
            currencyCode
          }
        }
      }
    }
  `;

  try {
    const response = await callAdminGraphql<{ data?: { order?: { totalPriceSet?: { presentmentMoney?: { amount?: string; currencyCode?: string } } } } }>({
      query,
      variables: { orderId: orderGid },
      shopDomain,
    });

    const amount = response.data?.order?.totalPriceSet?.presentmentMoney?.amount;
    return amount ? parseFloat(amount) : null;
  } catch (error) {
    console.error("Erreur lors de la récupération du montant de la commande:", error);
    return null;
  }
}

