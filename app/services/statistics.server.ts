import { RewardStatus } from "@prisma/client";
import prisma from "app/db.server";

export type TimeSeriesDataPoint = {
  date: string;
  count: number;
  amount?: number;
};

export type StatisticsData = {
  // Séries temporelles
  referrersOverTime: TimeSeriesDataPoint[];
  referralsOverTime: TimeSeriesDataPoint[];
  rewardsOverTime: TimeSeriesDataPoint[];
  codesUsageOverTime: TimeSeriesDataPoint[];
  
  // Répartition des statuts
  rewardsByStatus: {
    status: string;
    count: number;
    amount: number;
  }[];
  
  // Top parrains
  topReferrers: {
    id: string;
    name: string;
    totalReferrals: number;
    totalRewards: number;
    paidRewards: number;
    pendingRewards: number;
  }[];
  
  // Statistiques générales
  summary: {
    totalReferrers: number;
    totalCodes: number;
    totalReferrals: number;
    totalRewards: number;
    totalRewardsAmount: number;
    pendingRewardsAmount: number;
    paidRewardsAmount: number;
  };
  
  // Évolution des montants
  rewardsAmountOverTime: TimeSeriesDataPoint[];
};

/**
 * Récupère les statistiques complètes pour la page de statistiques
 */
export async function getStatisticsData(days: number = 30): Promise<StatisticsData> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // Générer les dates pour les séries temporelles
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  // Récupérer toutes les données nécessaires
  const [
    allReferrers,
    allReferrals,
    allRewards,
    allCodes,
  ] = await Promise.all([
    prisma.referrer.findMany({
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.referral.findMany({
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reward.findMany({
      select: { createdAt: true, amount: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.code.findMany({
      select: { createdAt: true, usageCount: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  
  // Calculer les séries temporelles
  const referrersOverTime = calculateTimeSeries(
    allReferrers.map((r) => r.createdAt),
    dates,
    startDate
  );
  
  const referralsOverTime = calculateTimeSeries(
    allReferrals.map((r) => r.createdAt),
    dates,
    startDate
  );
  
  const rewardsOverTime = calculateTimeSeries(
    allRewards.map((r) => r.createdAt),
    dates,
    startDate
  );
  
  // Codes usage over time (cumulatif)
  const codesUsageOverTime = calculateCumulativeUsage(allCodes, dates);
  
  // Rewards amount over time
  const rewardsAmountOverTime = calculateRewardsAmountOverTime(allRewards, dates, startDate);
  
  // Répartition des récompenses par statut
  // Ordre : PAID (vert/success), PENDING (jaune/warning), FAILED (rouge/critical)
  const rewardsByStatus = [
    {
      status: "PAID",
      count: allRewards.filter((r) => r.status === RewardStatus.PAID).length,
      amount: allRewards
        .filter((r) => r.status === RewardStatus.PAID)
        .reduce((sum, r) => sum + r.amount, 0),
    },
    {
      status: "PENDING",
      count: allRewards.filter((r) => r.status === RewardStatus.PENDING).length,
      amount: allRewards
        .filter((r) => r.status === RewardStatus.PENDING)
        .reduce((sum, r) => sum + r.amount, 0),
    },
    {
      status: "FAILED",
      count: allRewards.filter((r) => r.status === RewardStatus.FAILED).length,
      amount: allRewards
        .filter((r) => r.status === RewardStatus.FAILED)
        .reduce((sum, r) => sum + r.amount, 0),
    },
  ];
  
  // Top parrains
  const referrersWithStats = await prisma.referrer.findMany({
    include: {
      referrals: true,
      rewards: true,
    },
  });
  
  const topReferrers = referrersWithStats
    .map((referrer) => {
      const name =
        [referrer.firstName, referrer.lastName].filter(Boolean).join(" ") ||
        referrer.email ||
        referrer.shopifyCustomerId;
      
      const totalRewards = referrer.rewards.reduce((sum, r) => sum + r.amount, 0);
      const paidRewards = referrer.rewards
        .filter((r) => r.status === RewardStatus.PAID)
        .reduce((sum, r) => sum + r.amount, 0);
      const pendingRewards = referrer.rewards
        .filter((r) => r.status === RewardStatus.PENDING)
        .reduce((sum, r) => sum + r.amount, 0);
      
      return {
        id: referrer.id,
        name,
        totalReferrals: referrer.referrals.length,
        totalRewards,
        paidRewards,
        pendingRewards,
      };
    })
    .sort((a, b) => b.totalReferrals - a.totalReferrals)
    .slice(0, 10);
  
  // Statistiques générales
  const summary = {
    totalReferrers: allReferrers.length,
    totalCodes: allCodes.length,
    totalReferrals: allReferrals.length,
    totalRewards: allRewards.length,
    totalRewardsAmount: allRewards.reduce((sum, r) => sum + r.amount, 0),
    pendingRewardsAmount: allRewards
      .filter((r) => r.status === RewardStatus.PENDING)
      .reduce((sum, r) => sum + r.amount, 0),
    paidRewardsAmount: allRewards
      .filter((r) => r.status === RewardStatus.PAID)
      .reduce((sum, r) => sum + r.amount, 0),
  };
  
  return {
    referrersOverTime,
    referralsOverTime,
    rewardsOverTime,
    codesUsageOverTime,
    rewardsAmountOverTime,
    rewardsByStatus,
    topReferrers,
    summary,
  };
}

/**
 * Calcule une série temporelle avec comptage par jour
 */
function calculateTimeSeries(
  dates: Date[],
  dateRange: string[],
  startDate: Date
): TimeSeriesDataPoint[] {
  const dateCounts = new Map<string, number>();
  
  // Initialiser toutes les dates à 0
  dateRange.forEach((date) => {
    dateCounts.set(date, 0);
  });
  
  // Compter les occurrences par jour
  dates.forEach((date) => {
    if (date >= startDate) {
      const dateStr = date.toISOString().split('T')[0];
      const current = dateCounts.get(dateStr) || 0;
      dateCounts.set(dateStr, current + 1);
    }
  });
  
  return dateRange.map((date) => ({
    date,
    count: dateCounts.get(date) || 0,
  }));
}

/**
 * Calcule l'utilisation cumulative des codes
 * Pour chaque date, calcule la somme des usageCount de tous les codes créés jusqu'à cette date
 */
function calculateCumulativeUsage(
  codes: Array<{ createdAt: Date; usageCount: number }>,
  dateRange: string[]
): TimeSeriesDataPoint[] {
  // Pour chaque date, calculer la somme des usageCount de tous les codes créés jusqu'à cette date
  return dateRange.map((date) => {
    const targetDate = new Date(date);
    targetDate.setHours(23, 59, 59, 999); // Fin de la journée
    
    // Somme des usageCount de tous les codes créés jusqu'à cette date
    const totalUsage = codes
      .filter((code) => code.createdAt <= targetDate)
      .reduce((sum, code) => sum + code.usageCount, 0);
    
    return {
      date,
      count: totalUsage,
    };
  });
}

/**
 * Calcule l'évolution des montants de récompenses dans le temps
 */
function calculateRewardsAmountOverTime(
  rewards: Array<{ createdAt: Date; amount: number }>,
  dateRange: string[],
  startDate: Date
): TimeSeriesDataPoint[] {
  const amountByDate = new Map<string, number>();
  
  dateRange.forEach((date) => {
    amountByDate.set(date, 0);
  });
  
  rewards.forEach((reward) => {
    if (reward.createdAt >= startDate) {
      const dateStr = reward.createdAt.toISOString().split('T')[0];
      const current = amountByDate.get(dateStr) || 0;
      amountByDate.set(dateStr, current + reward.amount);
    }
  });
  
  return dateRange.map((date) => ({
    date,
    count: 0,
    amount: amountByDate.get(date) || 0,
  }));
}

