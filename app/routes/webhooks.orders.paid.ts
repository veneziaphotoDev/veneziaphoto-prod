import { type ActionFunction } from "@remix-run/node";
import {
  createCodeForReferrer,
  findCodeByOriginOrderId,
  findCodeByValue,
  linkShopifyDiscountId,
  markCodeAsUsed,
} from "app/services/codes.server";
import { recreateShopifyDiscount } from "app/services/discounts.server";
import { getOrCreateReferrerFromCustomer } from "app/services/referrers.server";
import { createReferral, findReferralByOrderId } from "app/services/referrals.server";
import { createPendingReward } from "app/services/rewards.server";
import { getReferralSettings } from "app/services/settings.server";
import { fetchOrderById } from "app/services/shopifyAdmin.server";
import prisma from "app/db.server";

type ShopifyOrderPaidPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  email?: string | null;
  currency?: string;
  discount_codes?: Array<{ code: string | null }>;
  customer?: {
    id: number | string;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
};

const respondOk = () => new Response("OK", { status: 200 });

const normalizeCode = (code?: string | null) => {
  if (!code) return null;
  const trimmed = code.trim();
  return trimmed.length ? trimmed : null;
};

export const action: ActionFunction = async ({ request }) => {
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain");
  const raw = await request.text();

  let payload: ShopifyOrderPaidPayload;

  try {
    payload = JSON.parse(raw);
  } catch (error) {
    console.error("❌ Impossible de parser le webhook orders/paid", error);
    return respondOk();
  }

  console.log(
    `🎯 Webhook orders/paid reçu${payload.id ? ` pour la commande ${payload.id}` : ""}`,
  );

  if (!payload.id || !payload.customer?.id) {
    console.warn("⚠️ Webhook orders/paid incomplet : customer ou order ID manquant");
    return respondOk();
  }

  const orderId = String(payload.id);

  try {
    const settings = await getReferralSettings();
    
    // Récupérer les détails complets de la commande pour obtenir les produits
    let workshopProductId: string | undefined;
    let workshopProductTitle: string | undefined;
    let workshopQuantity = 1;
    
    try {
      const orderDetails = await fetchOrderById(orderId, shopDomain);
      const lineItems = orderDetails.order?.line_items || [];
      
      // On prend le premier produit trouvé comme workshop et on calcule la quantité totale
      if (lineItems.length > 0) {
        const firstItem = lineItems[0];
        workshopProductId = String(firstItem.product_id || firstItem.variant_id);
        workshopProductTitle = firstItem.title || firstItem.name;
        // Calculer la quantité totale pour ce produit workshop dans la commande
        workshopQuantity = lineItems
          .filter((item: any) => {
            const itemProductId = String(item.product_id || item.variant_id);
            return itemProductId === workshopProductId;
          })
          .reduce((total: number, item: any) => total + (item.quantity || 1), 0);
      }
    } catch (orderError) {
      console.warn("⚠️ Impossible de récupérer les détails de la commande pour obtenir les produits", orderError);
    }
    
    const referrer = await getOrCreateReferrerFromCustomer(payload.customer);

    let codeRecord = await findCodeByOriginOrderId(orderId);
    if (!codeRecord) {
      codeRecord = await prisma.code.findFirst({
        where: {
          referrerId: referrer.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }

    if (!codeRecord) {
      codeRecord = await createCodeForReferrer({
        referrerId: referrer.id,
        settings,
        originOrderId: orderId,
        originOrderGid: payload.admin_graphql_api_id ?? null,
        workshopProductId: workshopProductId ?? undefined,
        workshopProductTitle: workshopProductTitle ?? undefined,
        workshopQuantity,
      });

      const discount = await recreateShopifyDiscount({
          code: codeRecord,
          settings,
          shopDomain,
        });

      if (discount) {
        await linkShopifyDiscountId(codeRecord.id, discount.discountId);
        console.log(
          `✅ Code ${discount.createdCode} créé pour ${referrer.email ?? referrer.shopifyCustomerId} (remise filleul ${(
            settings.discountPercentage * 100
          ).toFixed(0)} %, cashback ${settings.cashbackAmount.toFixed(2)})`,
        );
      }
    } else {
      const expiryDate =
        settings.codeValidityDays > 0
          ? (() => {
              const expiry = new Date();
              expiry.setUTCDate(expiry.getUTCDate() + settings.codeValidityDays);
              return expiry;
            })()
          : null;

      codeRecord = await prisma.code.update({
        where: { id: codeRecord.id },
        data: {
          originOrderId: orderId,
          originOrderGid: payload.admin_graphql_api_id ?? codeRecord.originOrderGid ?? undefined,
          workshopProductId: workshopProductId ?? codeRecord.workshopProductId ?? undefined,
          workshopProductTitle: workshopProductTitle ?? codeRecord.workshopProductTitle ?? undefined,
          workshopQuantity,
          expiresAt: expiryDate ?? null,
          maxUsage: settings.maxUsagePerCode,
          discountSnapshot: settings.discountPercentage,
          cashbackSnapshot: settings.cashbackAmount,
        },
      });

      console.log(
        `ℹ️ Code existant ${codeRecord.code} réutilisé pour la commande ${orderId}, pas de recréation.`,
      );

      const discount = await recreateShopifyDiscount({
        code: codeRecord,
        settings,
        shopDomain,
      });

      if (discount) {
        await linkShopifyDiscountId(codeRecord.id, discount.discountId);
        console.log(
          `ℹ️ Discount Shopify synchronisé pour le code ${codeRecord.code} (remise filleul ${(
            settings.discountPercentage * 100
          ).toFixed(0)} %, cashback ${settings.cashbackAmount.toFixed(2)})`,
        );
      }
    }

    const usedDiscount = normalizeCode(payload.discount_codes?.[0]?.code);

    if (!usedDiscount) {
      return respondOk();
    }

    const usedCodeRecord = await findCodeByValue(usedDiscount);

    if (!usedCodeRecord) {
      console.warn(`⚠️ Code ${usedDiscount} utilisé mais introuvable en base.`);
      return respondOk();
    }

    // Vérifier si une referral existe déjà pour cet orderId (protection contre les doublons)
    const existingReferral = await findReferralByOrderId(orderId);

    if (existingReferral) {
      console.log(`ℹ️ Referral déjà existante pour la commande ${orderId}, webhook ignoré (protection doublon)`);
      return respondOk();
    }

    const referral = await createReferral({
      referrerId: usedCodeRecord.referrerId,
      codeId: usedCodeRecord.id,
      refereeShopifyCustomerId: String(payload.customer.id),
      refereeEmail: payload.email ?? payload.customer.email ?? null,
      refereeFirstName: payload.customer.first_name ?? null,
      refereeLastName: payload.customer.last_name ?? null,
      orderId,
      workshopProductId: workshopProductId ?? undefined,
      workshopProductTitle: workshopProductTitle ?? undefined,
    });

    const reward = await createPendingReward({
      referrerId: usedCodeRecord.referrerId,
      referralId: referral.id,
      settings,
      currency: payload.currency ?? "EUR",
      workshopProductId: workshopProductId ?? undefined,
      workshopProductTitle: workshopProductTitle ?? undefined,
    });

    await markCodeAsUsed(usedCodeRecord.id);

    if (!usedCodeRecord.originOrderGid) {
      console.warn(
        `⚠️ Aucune information d'ordre Shopify sauvegardée pour le code ${usedCodeRecord.code}, refund manuel requis.`,
      );
      // Pas de refund possible tant que l'information n'est pas disponible, la reward reste en PENDING
    }
  } catch (runtimeError) {
    console.error("❌ Erreur lors du traitement du webhook orders/paid", runtimeError);
  }

  return respondOk();
};
