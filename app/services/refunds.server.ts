import { callAdminGraphql, getOrderTransactionParentId } from "./shopifyAdmin.server";

const REFUND_MUTATION = /* GraphQL */ `
mutation RefundReferral($input: RefundInput!) {
  refundCreate(input: $input) {
    refund {
      id
      totalRefundedSet {
        presentmentMoney {
          amount
          currencyCode
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

type RefundParams = {
  orderGid: string;
  amount: number;
  currency: string;
  note?: string;
  shopDomain?: string | null;
};

const DEFAULT_REFUND_NOTE = "Remboursement automatique - Parrainage";

function formatAmount(amount: number) {
  return amount.toFixed(2);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOrderUnavailableError(userErrors: any[]): boolean {
  return userErrors.some(
    (error) =>
      error.message?.toLowerCase().includes("temporarily unavailable") ||
      error.message?.toLowerCase().includes("unavailable to be modified")
  );
}

/**
 * Crée un remboursement partiel réel (lié à la transaction d’origine)
 * @param orderGid - GID de la commande Shopify (ex: gid://shopify/Order/12345)
 * @param amount - Montant à rembourser (partiel)
 * @param currency - Devise (ex: EUR)
 * @param note - Note affichée dans l'interface Shopify
 * @param shopDomain - Domaine Shopify (optionnel si multi-boutiques)
 */
export async function createReferralRefund({
  orderGid,
  amount,
  currency,
  note,
  shopDomain,
}: RefundParams) {
  // 🔎 Récupère la transaction de paiement associée à la commande
  const parentId = await getOrderTransactionParentId(orderGid, shopDomain);

  let variables: any;

  if (!parentId) {
    console.warn(`⚠️ Aucune transaction trouvée pour la commande ${orderGid}, utilisation du store credit`);
    // Fallback sur store credit si pas de transaction trouvée
    const gateway = process.env.SHOPIFY_REFUND_GATEWAY ?? "store-credit";
    variables = {
      input: {
        note: note ?? DEFAULT_REFUND_NOTE,
        orderId: orderGid,
        transactions: [
          {
            orderId: orderGid,
            amount: formatAmount(amount),
            kind: "REFUND",
            gateway,
          },
        ],
      },
    };
  } else {
    // 💳 Crée le refund rattaché à la transaction parent (refund direct)
    variables = {
      input: {
        note: note ?? DEFAULT_REFUND_NOTE,
        orderId: orderGid,
        transactions: [
          {
            orderId: orderGid,
            amount: formatAmount(amount),
            kind: "REFUND",
            parentId, // 🔗 clé pour un vrai remboursement
          },
        ],
      },
    };
  }

  // Retry avec délai si la commande est temporairement indisponible
  const maxRetries = 3;
  const retryDelay = 2000; // 2 secondes

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await callAdminGraphql<{ data?: any; errors?: any[] }>({
      query: REFUND_MUTATION,
      variables,
      shopDomain,
    });

    // 🧩 Gestion d'erreurs GraphQL
    if (response.errors?.length) {
      throw new Error(
        `Erreur GraphQL Shopify (refundCreate): ${JSON.stringify(response.errors)}`
      );
    }

    const payload = response.data?.refundCreate;

    if (!payload) {
      throw new Error(
        "Réponse inattendue de Shopify lors de la création du remboursement"
      );
    }

    if (payload.userErrors?.length) {
      // Si l'erreur est "order temporarily unavailable", on réessaie
      if (isOrderUnavailableError(payload.userErrors) && attempt < maxRetries - 1) {
        const waitTime = retryDelay * (attempt + 1);
        console.log(
          `⏳ Commande temporairement indisponible, nouvelle tentative dans ${waitTime}ms (${attempt + 1}/${maxRetries})`
        );
        await sleep(waitTime);
        continue;
      }

      throw new Error(
        `Erreurs Shopify (refundCreate): ${JSON.stringify(payload.userErrors)}`
      );
    }

    if (attempt > 0) {
      console.log(
        `✅ Refund créé avec succès après ${attempt + 1} tentative(s)`
      );
    }

    return payload.refund;
  }

  throw new Error(
    `Impossible de créer le refund après ${maxRetries} tentatives - la commande reste indisponible`
  );
}
