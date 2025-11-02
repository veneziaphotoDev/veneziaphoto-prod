import prisma from "app/db.server";

type ReferralInput = {
  referrerId: string;
  codeId?: string;
  refereeShopifyCustomerId?: string | null;
  refereeEmail?: string | null;
  refereeFirstName?: string | null;
  refereeLastName?: string | null;
  orderId?: string | null;
  workshopProductId?: string | null;
  workshopProductTitle?: string | null;
};

export async function createReferral(input: ReferralInput) {
  const data = {
    referrerId: input.referrerId,
    codeId: input.codeId ?? undefined,
    refereeShopifyCustomerId: input.refereeShopifyCustomerId ?? undefined,
    refereeEmail: input.refereeEmail ?? undefined,
    refereeFirstName: input.refereeFirstName ?? undefined,
    refereeLastName: input.refereeLastName ?? undefined,
    orderId: input.orderId ?? undefined,
    workshopProductId: input.workshopProductId ?? undefined,
    workshopProductTitle: input.workshopProductTitle ?? undefined,
  };

  if (input.orderId) {
    return prisma.referral.upsert({
      where: { orderId: input.orderId },
      create: data,
      update: data,
      include: {
        referrer: true,
        code: true,
      },
    });
  }

  return prisma.referral.create({
    data,
    include: {
      referrer: true,
      code: true,
    },
  });
}

export async function findReferralByOrderId(orderId: string) {
  return prisma.referral.findUnique({
    where: { orderId },
    include: {
      reward: true,
    },
  });
}

export async function listRecentReferrals(limit = 20) {
  return prisma.referral.findMany({
    include: {
      referrer: true,
      code: true,
      reward: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getReferralStats() {
  const [total, withRewards] = await Promise.all([
    prisma.referral.count(),
    prisma.referral.count({
      where: {
        reward: {
          isNot: null,
        },
      },
    }),
  ]);

  return {
    total,
    withRewards,
  };
}

