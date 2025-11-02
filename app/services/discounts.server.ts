import type { Code, Prisma } from "@prisma/client";
import { callAdminGraphql } from "./shopifyAdmin.server";
import type { ReferralSettings } from "./settings.server";

type CreateDiscountParams = {
  code: Code;
  settings: ReferralSettings;
  shopDomain?: string | null;
};

type DiscountCreateResult = {
  discountId: string;
  createdCode: string;
};

const DISCOUNT_MUTATION = /* GraphQL */ `
mutation CreateReferralDiscount($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          title
          codes(first: 1) {
            nodes {
              code
            }
          }
        }
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

const DISCOUNT_UPDATE_MUTATION = /* GraphQL */ `
mutation UpdateReferralDiscount($id: ID!, $input: DiscountCodeBasicInput!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
    codeDiscountNode {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          title
          codes(first: 1) {
            nodes {
              code
            }
          }
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

const DISCOUNT_DETAILS_QUERY = /* GraphQL */ `
query GetReferralDiscountDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on DiscountCodeNode {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          status
          startsAt
          endsAt
          usageLimit
          appliesOncePerCustomer
          customerGets {
            value {
              __typename
              ... on DiscountPercentage {
                percentage
              }
              ... on DiscountAmount {
                amount {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const DISCOUNT_DELETE_MUTATION = /* GraphQL */ `
mutation DeleteReferralDiscount($id: ID!) {
  discountCodeDelete(id: $id) {
    deletedCodeDiscountId
    userErrors {
      message
    }
  }
}
`;

function buildInput({ code, settings }: CreateDiscountParams): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const endsAt = code.expiresAt ? code.expiresAt.toISOString() : undefined;

  // Construire l'objet de base
  const baseInput: Record<string, unknown> = {
    title: `Parrainage - ${code.code}`,
    code: code.code,
    startsAt: nowIso,
    appliesOncePerCustomer: settings.appliesOncePerCustomer,
    customerGets: {
      value: {
        percentage: settings.discountPercentage,
      },
      items: {
        all: true,
      },
    },
  };

  // Ajouter endsAt si présent
  if (endsAt) {
    baseInput.endsAt = endsAt;
  }

  // Ajouter usageLimit si nécessaire
  if (settings.maxUsagePerCode > 0) {
    baseInput.usageLimit = settings.maxUsagePerCode;
  }

  // Gestion de la sélection des clients :
  // - Si des segments sont définis : utiliser context avec customerSegments
  // - Si aucun segment : utiliser customerSelection avec all: true
  const segmentIds = settings.customerSegmentIds || [];
  const validSegmentIds = segmentIds.filter((id) => {
    return typeof id === "string" && id.trim().length > 0;
  });
  
  // Construire l'objet final selon les segments
  if (validSegmentIds.length > 0) {
    // Si on a des segments, utiliser context
    return {
      ...baseInput,
      context: {
        customerSegments: {
          add: validSegmentIds,
        },
      },
    };
  } else {
    // Si pas de segments, utiliser customerSelection pour "tous les clients"
    return {
      ...baseInput,
      customerSelection: {
        all: true,
      },
    };
  }
}

export async function createShopifyDiscount(params: CreateDiscountParams): Promise<DiscountCreateResult> {
  const input = buildInput(params);
  
  // Vérifier et logger la configuration
  if ('context' in input) {
    const segments = (input.context as any)?.customerSegments?.add || [];
    if (segments.length > 0) {
      console.log(`ℹ️ Discount avec ${segments.length} segment(s) client (via context)`);
    }
  } else if ('customerSelection' in input) {
    console.log("ℹ️ Discount accessible à tous les clients (via customerSelection.all)");
  }
  
  // Log complet pour déboguer
  const inputParsed = JSON.parse(JSON.stringify(input));
  
  const variables = {
    input: inputParsed, // Utiliser l'objet parsé pour s'assurer qu'il est propre
  };

  const response = await callAdminGraphql<{ data?: any; errors?: any[] }>({
    query: DISCOUNT_MUTATION,
    variables,
    shopDomain: params.shopDomain,
  });

  if (response.errors?.length) {
    throw new Error(`Erreur GraphQL Shopify: ${JSON.stringify(response.errors)}`);
  }

  const payload = response.data?.discountCodeBasicCreate;

  if (!payload) {
    throw new Error("Réponse inattendue de Shopify lors de la création du discount");
  }

  if (payload.userErrors?.length) {
    // Log détaillé des erreurs
    console.error("❌ Erreurs détaillées de Shopify:", JSON.stringify(payload.userErrors, null, 2));
    throw new Error(`Erreurs Shopify: ${JSON.stringify(payload.userErrors)}`);
  }

  const discountId: string | undefined = payload.codeDiscountNode?.id;
  const createdCode: string | undefined = payload.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code;

  if (!discountId || !createdCode) {
    throw new Error(`Réponse Shopify incomplète: ${JSON.stringify(payload)}`);
  }

  return {
    discountId,
    createdCode,
  };
}

export async function deleteShopifyDiscount(
  discountId: string,
  shopDomain?: string | null,
): Promise<void> {
  const response = await callAdminGraphql<{
    data?: {
      discountCodeDelete?: {
        deletedCodeDiscountId?: string;
        userErrors?: Array<{ message?: string }>;
      };
    };
    errors?: Array<{ message?: string }>;
  }>({
    query: DISCOUNT_DELETE_MUTATION,
    variables: { id: discountId },
    shopDomain,
  });

  const payload = response.data?.discountCodeDelete;

  if (!payload) {
    const fallback = response.errors?.[0]?.message ?? "Réponse inattendue de Shopify";
    throw new Error(`Impossible de supprimer le discount Shopify: ${fallback}`);
  }

  if (payload.userErrors && payload.userErrors.length > 0) {
    const messages = payload.userErrors.map((error) => error.message ?? "").join(", ");
    throw new Error(`Impossible de supprimer le discount Shopify: ${messages}`);
  }

  if (!payload.deletedCodeDiscountId) {
    throw new Error("Shopify n'a pas confirmé la suppression du discount.");
  }
}

export async function recreateShopifyDiscount(params: CreateDiscountParams): Promise<DiscountCreateResult | null> {
  if (params.code.shopifyDiscountId) {
    try {
      const input = buildInput(params);
      const response = await callAdminGraphql<{
        data?: {
          discountCodeBasicUpdate?: {
            codeDiscountNode?: {
              id?: string;
              codeDiscount?: {
                codes?: {
                  nodes?: Array<{ code?: string }>;
                };
              };
            };
            userErrors?: Array<{ field?: Array<string>; message?: string }>;
          };
        };
      }>({
        query: DISCOUNT_UPDATE_MUTATION,
        variables: {
          id: params.code.shopifyDiscountId,
          input,
        },
        shopDomain: params.shopDomain,
      });

      const payload = response.data?.discountCodeBasicUpdate;

      if (payload?.userErrors?.length) {
        const message = payload.userErrors.map((error) => error.message ?? "").join(", ");
        throw new Error(message || "Impossible de mettre à jour le discount Shopify.");
      }

      const node = payload?.codeDiscountNode;
      if (node?.id) {
        const discountId = node.id;
        const createdCode =
          node.codeDiscount?.codes?.nodes?.[0]?.code ?? params.code.code;
        return { discountId, createdCode };
      }
    } catch (error) {
      console.error("❌ Impossible de mettre à jour le discount Shopify", error);
      return null;
    }
  }

  try {
    return await createShopifyDiscount(params);
  } catch (error) {
    console.error("❌ Impossible de créer le discount Shopify", error);
    return null;
  }
}

export type DiscountDetails = {
  percentage: number | null;
  amountValue: number | null;
  amountCurrencyCode: string | null;
  usageLimit: number | null;
  appliesOncePerCustomer: boolean | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
};

export async function fetchShopifyDiscountDetails(
  discountIds: string[],
  shopDomain?: string | null,
): Promise<Record<string, DiscountDetails>> {
  if (discountIds.length === 0) {
    return {};
  }

  const uniqueIds = Array.from(new Set(discountIds));

  try {
    const response = await callAdminGraphql<{
      data?: {
        nodes?: Array<{
          __typename?: string;
          id?: string;
          codeDiscount?: {
            __typename?: string;
            status?: string | null;
            startsAt?: string | null;
            endsAt?: string | null;
            usageLimit?: number | null;
            appliesOncePerCustomer?: boolean | null;
            customerGets?: {
              value?: {
                __typename?: string;
                percentage?: number | null;
                amount?: {
                  amount?: string | null;
                  currencyCode?: string | null;
                } | null;
              } | null;
            } | null;
          } | null;
        }>;
      };
      errors?: Array<{ message?: string }>;
    }>({
      query: DISCOUNT_DETAILS_QUERY,
      variables: { ids: uniqueIds },
      shopDomain,
    });

    const nodes = response.data?.nodes ?? [];
    const result: Record<string, DiscountDetails> = {};

    for (const node of nodes) {
      if (!node || node.__typename !== "DiscountCodeNode" || !node.id) {
        continue;
      }

      const discount = node.codeDiscount;
      if (!discount || discount.__typename !== "DiscountCodeBasic") {
        result[node.id] = {
          percentage: null,
          amountValue: null,
          amountCurrencyCode: null,
          usageLimit: null,
          appliesOncePerCustomer: null,
          startsAt: null,
          endsAt: null,
          status: discount?.status ?? null,
        };
        continue;
      }

      const value = discount.customerGets?.value;
      let percentage: number | null = null;
      let amountValue: number | null = null;
      let amountCurrencyCode: string | null = null;

      if (value?.__typename === "DiscountPercentage") {
        const raw = typeof value.percentage === "number" ? value.percentage : null;
        percentage = raw !== null && Number.isFinite(raw) ? raw : null;
      } else if (value?.__typename === "DiscountAmount") {
        const rawAmount = value.amount?.amount ?? null;
        const parsed = rawAmount !== null ? Number.parseFloat(rawAmount) : null;
        amountValue = parsed !== null && Number.isFinite(parsed) ? parsed : null;
        amountCurrencyCode = value.amount?.currencyCode ?? null;
      }

      result[node.id] = {
        percentage,
        amountValue,
        amountCurrencyCode,
        usageLimit: discount.usageLimit ?? null,
        appliesOncePerCustomer: discount.appliesOncePerCustomer ?? null,
        startsAt: discount.startsAt ?? null,
        endsAt: discount.endsAt ?? null,
        status: discount.status ?? null,
      };
    }

    return result;
  } catch (error) {
    console.error("❌ Impossible de récupérer les détails des discounts Shopify :", error);
    return {};
  }
}




