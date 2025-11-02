import { RewardStatus } from "@prisma/client";
import prisma from "app/db.server";
import { deleteShopifyDiscount } from "./discounts.server";

type ShopifyCustomerPayload = {
  id: number | string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export async function getOrCreateReferrerFromCustomer(customer: ShopifyCustomerPayload) {
  const shopifyCustomerId = String(customer.id);

  const existing = await prisma.referrer.findUnique({
    where: { shopifyCustomerId },
  });

  if (existing) {
    // Mettre à jour les infos de contact si elles ont changé
    const needUpdate =
      existing.email !== customer.email ||
      existing.firstName !== customer.first_name ||
      existing.lastName !== customer.last_name;

    if (needUpdate) {
      return prisma.referrer.update({
        where: { id: existing.id },
        data: {
          email: customer.email ?? existing.email,
          firstName: customer.first_name ?? existing.firstName,
          lastName: customer.last_name ?? existing.lastName,
        },
      });
    }

    return existing;
  }

  return prisma.referrer.create({
    data: {
      shopifyCustomerId,
      email: customer.email ?? undefined,
      firstName: customer.first_name ?? undefined,
      lastName: customer.last_name ?? undefined,
    },
  });
}

type ListReferrersOptions = {
  limit?: number;
  offset?: number;
  search?: string;
};

export async function listReferrersWithStats(options: ListReferrersOptions = {}) {
  const { limit = 50, offset = 0, search } = options;

  // Construire les conditions de recherche
  const searchCondition = search
    ? {
        OR: [
          { email: { contains: search, mode: "insensitive" as const } },
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          { shopifyCustomerId: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const where = searchCondition ? { ...searchCondition } : undefined;

  const [referrers, total] = await Promise.all([
    prisma.referrer.findMany({
      where,
      include: {
        codes: {
          orderBy: { createdAt: "desc" },
        },
        referrals: true,
        rewards: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.referrer.count({ where }),
  ]);

  const mapped = referrers.map((referrer) => {
    const latestCode = referrer.codes.at(0);
    const pendingRewards = referrer.rewards.filter((reward) => reward.status === RewardStatus.PENDING);
    const paidRewards = referrer.rewards.filter((reward) => reward.status === RewardStatus.PAID);

    return {
      id: referrer.id,
      name: [referrer.firstName, referrer.lastName].filter(Boolean).join(" ") || referrer.email || referrer.shopifyCustomerId,
      email: referrer.email,
      shopifyCustomerId: referrer.shopifyCustomerId,
      latestCode: latestCode?.code ?? null,
      latestCodeCreatedAt: latestCode?.createdAt ?? null,
      latestWorkshop: latestCode?.workshopProductTitle ?? null,
      totalCodes: referrer.codes.length,
      totalReferrals: referrer.referrals.length,
      pendingRewardsCount: pendingRewards.length,
      pendingRewardsAmount: pendingRewards.reduce((sum, reward) => sum + reward.amount, 0),
      paidRewardsAmount: paidRewards.reduce((sum, reward) => sum + reward.amount, 0),
      createdAt: referrer.createdAt,
      nextPendingRewardId: pendingRewards.at(0)?.id ?? null,
    };
  });

  return {
    referrers: mapped,
    total,
    hasMore: offset + limit < total,
  };
}

export async function getReferrerDetail(id: string) {
  return prisma.referrer.findUnique({
    where: { id },
    include: {
      codes: {
        orderBy: { createdAt: "desc" },
      },
      referrals: {
        orderBy: { createdAt: "desc" },
        include: {
          reward: true,
          code: true,
        },
      },
      rewards: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

type DeleteReferrerOptions = {
  shopDomain?: string | null;
};

export async function deleteReferrer(referrerId: string, options: DeleteReferrerOptions = {}) {
  const codes = await prisma.code.findMany({
    where: { referrerId },
    select: {
      id: true,
      shopifyDiscountId: true,
    },
  });

  for (const code of codes) {
    if (!code.shopifyDiscountId) continue;
    try {
      await deleteShopifyDiscount(code.shopifyDiscountId, options.shopDomain);
      console.log(`🗑️ Discount Shopify ${code.shopifyDiscountId} supprimé pour le code ${code.id}`);
    } catch (error) {
      console.error(
        `❌ Impossible de supprimer le discount Shopify ${code.shopifyDiscountId} pour le code ${code.id}`,
        error,
      );
    }
  }

  await prisma.$transaction([
    prisma.emailLog.deleteMany({ where: { referrerId } }),
    prisma.reward.deleteMany({ where: { referrerId } }),
    prisma.referral.deleteMany({ where: { referrerId } }),
    prisma.code.deleteMany({ where: { referrerId } }),
    prisma.referrer.delete({ where: { id: referrerId } }),
  ]);
}

