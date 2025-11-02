import { RewardStatus } from "@prisma/client";
import prisma from "app/db.server";
import { sendCashbackConfirmationEmail } from "./email.server";
import { createReferralRefund } from "./refunds.server";
import type { ReferralSettings } from "./settings.server";
import { getReferralSettings } from "./settings.server";
import { getOrderTotalAmount } from "./shopifyAdmin.server";

type RewardInput = {
  referrerId: string;
  referralId?: string;
  settings: ReferralSettings;
  currency?: string;
  workshopProductId?: string | null;
  workshopProductTitle?: string | null;
};

export async function createPendingReward({ referrerId, referralId, settings, currency = "EUR", workshopProductId, workshopProductTitle }: RewardInput) {
  return prisma.reward.create({
    data: {
      referrerId,
      referralId,
      amount: settings.cashbackAmount,
      currency,
      status: RewardStatus.PENDING,
      workshopProductId: workshopProductId ?? undefined,
      workshopProductTitle: workshopProductTitle ?? undefined,
    },
  });
}

export async function markRewardAsPaid(rewardId: string) {
  return prisma.reward.update({
    where: { id: rewardId },
    data: {
      status: RewardStatus.PAID,
      paidAt: new Date(),
    },
  });
}

export async function listRewards(limit = 100) {
  return prisma.reward.findMany({
    include: {
      referrer: true,
      referral: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getRewardStats() {
  const [pending, paid, total] = await Promise.all([
    prisma.reward.aggregate({
      where: { status: RewardStatus.PENDING },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.reward.aggregate({
      where: { status: RewardStatus.PAID },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.reward.aggregate({
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  return {
    pendingCount: pending._count._all,
    pendingAmount: pending._sum.amount ?? 0,
    paidCount: paid._count._all,
    paidAmount: paid._sum.amount ?? 0,
    totalCount: total._count._all,
    totalAmount: total._sum.amount ?? 0,
  };
}

/**
 * Calcule le total des refunds déjà effectués pour un code donné (via originOrderGid)
 * En utilisant les rewards PAYED liés aux codes qui ont le même originOrderGid
 */
export async function getTotalRefundedForCode(originOrderGid: string): Promise<number> {
  // Trouver tous les codes avec le même originOrderGid
  const codesWithSameOrigin = await prisma.code.findMany({
    where: {
      originOrderGid: originOrderGid,
    },
    select: {
      id: true,
    },
  });

  if (codesWithSameOrigin.length === 0) {
    return 0;
  }

  const codeIds = codesWithSameOrigin.map(c => c.id);

  // Calculer le total des rewards PAYED pour ces codes
  const result = await prisma.reward.aggregate({
    where: {
      status: RewardStatus.PAID,
      referral: {
        codeId: {
          in: codeIds,
        },
      },
    },
    _sum: {
      amount: true,
    },
  });

  return result._sum.amount ?? 0;
}

export type ProcessRewardRefundResult = {
  rewardId: string;
  totalRefunded: number;
  maxRefundAllowed: number | null;
};

type ProcessRewardRefundParams = {
  rewardId: string;
  shopDomain?: string | null;
  orderGidOverride?: string | null;
};

function extractNumericId(gid: string): string {
  const segments = gid.split("/");
  return segments[segments.length - 1] || gid;
}

export async function processRewardRefund({
  rewardId,
  shopDomain,
  orderGidOverride,
}: ProcessRewardRefundParams): Promise<ProcessRewardRefundResult> {
  const reward = await prisma.reward.findUnique({
    where: { id: rewardId },
    include: {
      referral: {
        include: {
          code: true,
        },
      },
      referrer: true,
    },
  });

  if (!reward) {
    throw new Error("Récompense introuvable.");
  }

  if (reward.status !== RewardStatus.PENDING) {
    throw new Error("Seules les récompenses en attente peuvent être remboursées.");
  }

  const originOrderGid = orderGidOverride ?? reward.referral?.code?.originOrderGid;

  if (!originOrderGid) {
    throw new Error(
      "Impossible de déclencher le refund : aucun order Shopify sélectionné ou associé.",
    );
  }

  if (orderGidOverride && reward.referral?.code && !reward.referral.code.originOrderGid) {
    await prisma.code.update({
      where: { id: reward.referral.code.id },
      data: {
        originOrderGid: orderGidOverride,
        originOrderId: extractNumericId(orderGidOverride),
      },
    });
  }

  if (orderGidOverride) {
    console.log(
      `🔁 Refund override: utilisation de la commande ${orderGidOverride} pour la reward ${reward.id}`,
    );
  } else if (reward.referral?.code?.originOrderGid) {
    console.log(
      `🔁 Refund via commande d'origine ${reward.referral.code.originOrderGid} pour la reward ${reward.id}`,
    );
  }

  const [settings, orderTotalAmount, totalRefundedBefore] = await Promise.all([
    getReferralSettings(),
    getOrderTotalAmount(originOrderGid, shopDomain),
    getTotalRefundedForCode(originOrderGid),
  ]);

  const maxRefundAllowed = orderTotalAmount
    ? orderTotalAmount * settings.maxRefundPercentage
    : null;

  if (
    maxRefundAllowed !== null &&
    totalRefundedBefore + reward.amount > maxRefundAllowed
  ) {
    const refundLeft = Math.max(0, maxRefundAllowed - totalRefundedBefore);
    throw new Error(
      `Limite de refund atteinte : il reste ${refundLeft.toFixed(2)} ${reward.currency} disponibles.`,
    );
  }

  await createReferralRefund({
    orderGid: originOrderGid,
    amount: reward.amount,
    currency: reward.currency,
    shopDomain,
    note: "Remboursement manuel - Parrainage",
  });

  await markRewardAsPaid(reward.id);

  const totalRefundedAfter = totalRefundedBefore + reward.amount;

  try {
    await sendCashbackConfirmationEmail({
      referrerId: reward.referrerId,
      referrerEmail: reward.referrer.email,
      firstName: reward.referrer.firstName,
      lastName: reward.referrer.lastName,
      cashbackAmount: reward.amount,
      refereeEmail: reward.referral?.refereeEmail ?? null,
    });
  } catch (error) {
    console.error(
      `❌ Erreur lors de l'envoi de l'email de confirmation cashback pour la récompense ${reward.id}`,
      error,
    );
  }

  return {
    rewardId: reward.id,
    totalRefunded: totalRefundedAfter,
    maxRefundAllowed,
  };
}

/**
 * Calcule le total des refunds déjà effectués pour un referrer donné
 * Utile si on veut limiter par parrain plutôt que par code
 */
export async function getTotalRefundedForReferrer(referrerId: string): Promise<number> {
  const result = await prisma.reward.aggregate({
    where: {
      referrerId,
      status: RewardStatus.PAID,
    },
    _sum: {
      amount: true,
    },
  });

  return result._sum.amount ?? 0;
}

