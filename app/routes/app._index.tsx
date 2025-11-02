import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  InlineGrid,
  BlockStack,
  Text,
  IndexTable,
  Badge,
} from "@shopify/polaris";
import prisma from "app/db.server";
import { listReferrersWithStats } from "app/services/referrers.server";
import { getReferralStats, listRecentReferrals } from "app/services/referrals.server";
import { getRewardStats } from "app/services/rewards.server";
import { getReferralSettings } from "app/services/settings.server";
import { authenticate } from "app/shopify.server";

const currencyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
});

type LoaderData = {
  metrics: {
    totalReferrers: number;
    totalReferrals: number;
    referralsWithRewards: number;
    rewardsPendingAmount: number;
    rewardsPendingCount: number;
    rewardsPaidAmount: number;
    rewardsPaidCount: number;
  };
  referrers: Array<{
    id: string;
    name: string;
    email: string | null;
    latestCode: string | null;
    latestWorkshop: string | null;
    totalReferrals: number;
    pendingRewardsAmount: number;
    paidRewardsAmount: number;
  }>;
  recentReferrals: Array<{
    id: string;
    referrerId: string;
    referrerName: string;
    refereeEmail: string | null;
    code: string | null;
    workshopProductTitle: string | null;
    rewardStatus: string | null;
    rewardAmount: number | null;
    createdAt: string;
  }>;
  hasCustomerSegments: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [referrerResult, recentReferralsRaw, rewardStats, referralStats, totalReferrers, settings] =
    await Promise.all([
      listReferrersWithStats({ limit: 10 }),
      listRecentReferrals(10),
      getRewardStats(),
      getReferralStats(),
      prisma.referrer.count(),
      getReferralSettings(),
    ]);

  const referrers = referrerResult.referrers.map((summary) => ({
    id: summary.id,
    name: summary.name,
    email: summary.email ?? null,
    latestCode: summary.latestCode,
    latestWorkshop: summary.latestWorkshop ?? null,
    totalReferrals: summary.totalReferrals,
    pendingRewardsAmount: summary.pendingRewardsAmount,
    paidRewardsAmount: summary.paidRewardsAmount,
  }));

  const recentReferrals = recentReferralsRaw.map((referral) => ({
    id: referral.id,
    referrerId: referral.referrerId,
    referrerName:
      [referral.referrer.firstName, referral.referrer.lastName]
        .filter(Boolean)
        .join(" ") || referral.referrer.email || referral.referrer.shopifyCustomerId,
    refereeEmail: referral.refereeEmail ?? null,
    code: referral.code?.code ?? null,
    workshopProductTitle: referral.workshopProductTitle ?? null,
    rewardStatus: referral.reward?.status ?? null,
    rewardAmount: referral.reward?.amount ?? null,
    createdAt: referral.createdAt.toISOString(),
  }));

  // Vérifier si des segments clients sont définis
  const validSegmentIds = (settings.customerSegmentIds || []).filter(
    (id) => typeof id === "string" && id.trim().length > 0
  );
  const hasCustomerSegments = validSegmentIds.length > 0;

  return json<LoaderData>({
    metrics: {
      totalReferrers,
      totalReferrals: referralStats.total,
      referralsWithRewards: referralStats.withRewards,
      rewardsPendingAmount: rewardStats.pendingAmount,
      rewardsPendingCount: rewardStats.pendingCount,
      rewardsPaidAmount: rewardStats.paidAmount,
      rewardsPaidCount: rewardStats.paidCount,
    },
    referrers,
    recentReferrals,
    hasCustomerSegments,
  });
};

export default function Dashboard() {
  const { metrics, referrers, recentReferrals, hasCustomerSegments } = useLoaderData<typeof loader>();

  return (
    <Page title="Tableau de bord">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" tone="subdued">
                Vue d'ensemble du programme de parrainage. Consultez les statistiques clés, les parrains actifs et les derniers filleuls enregistrés.
              </Text>
              {!hasCustomerSegments && (
                <Text variant="bodyMd" as="p" tone="critical">
                  ⚠️ Attention : pas de segment client défini. Les codes de parrainage sont accessibles à tous les clients.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">
                  Parrains actifs
                </Text>
                <Text variant="heading2xl" as="p">
                  {metrics.totalReferrers}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">
                  Filleuls enregistrés
                </Text>
                <Text variant="heading2xl" as="p">
                  {metrics.totalReferrals}
                </Text>
                <Text tone="subdued" as="p">
                  {metrics.referralsWithRewards} avec récompense
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">
                  Récompenses en attente
                </Text>
                <Text variant="heading2xl" as="p">
                  {currencyFormatter.format(metrics.rewardsPendingAmount)}
                </Text>
                <Text tone="subdued" as="p">
                  {metrics.rewardsPendingCount} récompense(s)
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">
                  Récompenses payées
                </Text>
                <Text variant="heading2xl" as="p">
                  {currencyFormatter.format(metrics.rewardsPaidAmount)}
                </Text>
                <Text tone="subdued" as="p">
                  {metrics.rewardsPaidCount} récompense(s)
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <IndexTable
              resourceName={{ singular: "parrain", plural: "parrains" }}
              itemCount={referrers.length}
              headings={[
                { title: "Parrain" },
                { title: "Dernier workshop" },
                { title: "Dernier code" },
                { title: "Parrainages" },
                { title: "En attente" },
                { title: "Versé" },
              ]}
              selectable={false}
            >
              {referrers.map((parrain, index) => (
                <IndexTable.Row id={parrain.id} key={parrain.id} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="bold" as="h3">
                      {parrain.name}
                    </Text>
                    {parrain.email && (
                      <Text variant="bodySm" as="p" tone="subdued">
                        {parrain.email}
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{parrain.latestWorkshop ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{parrain.latestCode ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{parrain.totalReferrals}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {currencyFormatter.format(parrain.pendingRewardsAmount)}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {currencyFormatter.format(parrain.paidRewardsAmount)}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card >
            <IndexTable
              resourceName={{ singular: "filleul", plural: "filleuls" }}
              itemCount={recentReferrals.length}
              headings={[
                { title: "Date" },
                { title: "Parrain" },
                { title: "Email filleul" },
                { title: "Workshop" },
                { title: "Code" },
                { title: "Récompense" },
              ]}
              selectable={false}
            >
              {recentReferrals.map((referral, index) => (
                <IndexTable.Row id={referral.id} key={referral.id} position={index}>
                  <IndexTable.Cell>
                    {dateFormatter.format(new Date(referral.createdAt))}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{referral.referrerName}</IndexTable.Cell>
                  <IndexTable.Cell>{referral.refereeEmail ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{referral.workshopProductTitle ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{referral.code ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {referral.rewardStatus ? (
                      <Badge
                        tone={
                          referral.rewardStatus === "PAID"
                            ? "success"
                            : referral.rewardStatus === "PENDING"
                              ? "attention"
                              : "critical"
                        }
                      >
                        {referral.rewardAmount !== null
                          ? currencyFormatter.format(referral.rewardAmount)
                          : "—"}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
