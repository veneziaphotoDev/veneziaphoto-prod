import prisma from "app/db.server";

export type ReferralSettings = {
  discountPercentage: number;
  cashbackAmount: number;
  codeValidityDays: number;
  appliesOncePerCustomer: boolean;
  maxUsagePerCode: number;
  maxRefundPercentage: number;
  customerSegmentIds: string[];
};

const DEFAULT_SETTINGS: ReferralSettings = {
  discountPercentage: 0.1,
  cashbackAmount: 20,
  codeValidityDays: 30,
  appliesOncePerCustomer: true,
  maxUsagePerCode: 0,
  maxRefundPercentage: 1.0, // 100% par défaut (pas de limite)
  customerSegmentIds: [],
};

const SETTINGS_ID = 1;

function parseSegmentIds(raw: string | null | undefined) {
  if (!raw) return [] as string[];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((segment): segment is string => typeof segment === "string") : [];
  } catch (error) {
    console.warn("Impossible de parser customerSegmentIds depuis AppSetting", error);
    return [];
  }
}

function serializeSegmentIds(segmentIds: string[]) {
  return JSON.stringify(segmentIds);
}

export async function getReferralSettings(): Promise<ReferralSettings> {
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  

  if (!settings) {
    const created = await prisma.appSetting.create({
      data: {
      id: SETTINGS_ID,
      discountPercentage: DEFAULT_SETTINGS.discountPercentage,
      cashbackAmount: DEFAULT_SETTINGS.cashbackAmount,
      codeValidityDays: DEFAULT_SETTINGS.codeValidityDays,
      appliesOncePerCustomer: DEFAULT_SETTINGS.appliesOncePerCustomer,
      maxUsagePerCode: DEFAULT_SETTINGS.maxUsagePerCode,
      maxRefundPercentage: DEFAULT_SETTINGS.maxRefundPercentage,
      customerSegmentIds: serializeSegmentIds(DEFAULT_SETTINGS.customerSegmentIds),
      },
    });

    return {
      discountPercentage: created.discountPercentage,
      cashbackAmount: created.cashbackAmount,
      codeValidityDays: created.codeValidityDays,
      appliesOncePerCustomer: created.appliesOncePerCustomer,
      maxUsagePerCode: created.maxUsagePerCode,
      maxRefundPercentage: created.maxRefundPercentage ?? DEFAULT_SETTINGS.maxRefundPercentage,
      customerSegmentIds: DEFAULT_SETTINGS.customerSegmentIds,
    };
  }

  return {
    discountPercentage: settings.discountPercentage,
    cashbackAmount: settings.cashbackAmount,
    codeValidityDays: settings.codeValidityDays,
    appliesOncePerCustomer: settings.appliesOncePerCustomer,
    maxUsagePerCode: settings.maxUsagePerCode,
    maxRefundPercentage: settings.maxRefundPercentage ?? DEFAULT_SETTINGS.maxRefundPercentage,
    customerSegmentIds: parseSegmentIds(settings.customerSegmentIds),
  };
}

export async function updateReferralSettings(partial: Partial<ReferralSettings>): Promise<ReferralSettings> {
  const existing = await getReferralSettings();

  const next: ReferralSettings = {
    discountPercentage: partial.discountPercentage !== undefined ? partial.discountPercentage : existing.discountPercentage,
    cashbackAmount: partial.cashbackAmount !== undefined ? partial.cashbackAmount : existing.cashbackAmount,
    codeValidityDays: partial.codeValidityDays !== undefined ? partial.codeValidityDays : existing.codeValidityDays,
    appliesOncePerCustomer: partial.appliesOncePerCustomer !== undefined ? partial.appliesOncePerCustomer : existing.appliesOncePerCustomer,
    maxUsagePerCode: partial.maxUsagePerCode !== undefined ? partial.maxUsagePerCode : existing.maxUsagePerCode,
    maxRefundPercentage: partial.maxRefundPercentage !== undefined ? partial.maxRefundPercentage : existing.maxRefundPercentage,
    customerSegmentIds: partial.customerSegmentIds !== undefined ? partial.customerSegmentIds : existing.customerSegmentIds,
  };

  await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      discountPercentage: next.discountPercentage,
      cashbackAmount: next.cashbackAmount,
      codeValidityDays: next.codeValidityDays,
      appliesOncePerCustomer: next.appliesOncePerCustomer,
      maxUsagePerCode: next.maxUsagePerCode,
      maxRefundPercentage: next.maxRefundPercentage,
      customerSegmentIds: serializeSegmentIds(next.customerSegmentIds),
    },
    update: {
      discountPercentage: next.discountPercentage,
      cashbackAmount: next.cashbackAmount,
      codeValidityDays: next.codeValidityDays,
      appliesOncePerCustomer: next.appliesOncePerCustomer,
      maxUsagePerCode: next.maxUsagePerCode,
      maxRefundPercentage: next.maxRefundPercentage,
      customerSegmentIds: serializeSegmentIds(next.customerSegmentIds),
    },
  });

  return next;
}

export { DEFAULT_SETTINGS };



