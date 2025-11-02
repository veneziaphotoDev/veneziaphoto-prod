import prisma from "app/db.server";
import type { ReferralSettings } from "./settings.server";
import { sendPromoCodeEmail } from "./email.server";

export function generateReferralCode(): string {
  const letters = Array.from({ length: 3 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26))
  ).join("");

  const numbers = Math.floor(1000 + Math.random() * 9000);

  return `${letters}-${numbers}`;
}

function computeExpiryDate(codeValidityDays: number): Date | null {
  if (codeValidityDays <= 0) {
    return null;
  }

  const expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + codeValidityDays);
  return expiry;
}

type CreateCodeParams = {
  referrerId: string;
  settings: ReferralSettings;
  originOrderId?: string | null;
  originOrderGid?: string | null;
  workshopProductId?: string | null;
  workshopProductTitle?: string | null;
  workshopQuantity?: number;
  sendEmail?: boolean;
};

export async function createCodeForReferrer({
  referrerId,
  settings,
  originOrderGid,
  originOrderId,
  workshopProductId,
  workshopProductTitle,
  workshopQuantity = 1,
  sendEmail = true,
}: CreateCodeParams) {
  let code = generateReferralCode();
  let attempts = 0;

  while (attempts < 5) {
    const existing = await prisma.code.findUnique({ where: { code } });

    if (!existing) {
      break;
    }

    code = generateReferralCode();
    attempts += 1;
  }

  if (attempts >= 5) {
    throw new Error("Impossible de générer un code de parrainage unique après plusieurs tentatives.");
  }

  const expiresAt = computeExpiryDate(settings.codeValidityDays);

  const codeRecord = await prisma.code.create({
    data: {
      referrerId,
      code,
      maxUsage: settings.maxUsagePerCode,
      expiresAt: expiresAt ?? undefined,
      originOrderId: originOrderId ?? undefined,
      originOrderGid: originOrderGid ?? undefined,
      workshopProductId: workshopProductId ?? undefined,
      workshopProductTitle: workshopProductTitle ?? undefined,
      workshopQuantity: workshopQuantity ?? 1,
      discountSnapshot: settings.discountPercentage,
      cashbackSnapshot: settings.cashbackAmount,
    },
    include: {
      referrer: true,
    },
  });

  if (sendEmail) {
    // Envoyer l'email avec le code promo (en arrière-plan, ne pas bloquer si ça échoue)
    try {
      console.log(
        `📧 Tentative d'envoi d'email pour le code ${codeRecord.code} à ${codeRecord.referrer.email || "pas d'email"}`,
      );
      await sendPromoCodeEmail({
        referrerId,
        codeId: codeRecord.id,
        referrerEmail: codeRecord.referrer.email,
        firstName: codeRecord.referrer.firstName,
        lastName: codeRecord.referrer.lastName,
        code: codeRecord.code,
        workshopTitle: codeRecord.workshopProductTitle,
        workshopQuantity: codeRecord.workshopQuantity,
        expiresAt,
        discountPercentage: codeRecord.discountSnapshot ?? settings.discountPercentage,
        cashbackAmount: codeRecord.cashbackSnapshot ?? settings.cashbackAmount,
      });
      console.log(`✅ Email envoyé avec succès pour le code ${codeRecord.code}`);
    } catch (emailError) {
      // Log l'erreur mais ne bloque pas la création du code
      console.error("❌ Erreur lors de l'envoi de l'email de code promo:", emailError);
    }
  }

  return codeRecord;
}

export async function markCodeAsUsed(codeId: string) {
  return prisma.code.update({
    where: { id: codeId },
    data: { usageCount: { increment: 1 } },
  });
}

export async function findCodeByValue(code: string) {
  return prisma.code.findUnique({
    where: { code },
    include: {
      referrer: true,
    },
  });
}

export async function linkShopifyDiscountId(codeId: string, discountId: string) {
  return prisma.code.update({
    where: { id: codeId },
    data: { shopifyDiscountId: discountId },
  });
}

export async function findCodeByOriginOrderId(originOrderId: string) {
  return prisma.code.findFirst({
    where: { originOrderId },
  });
}

