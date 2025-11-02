import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    InlineStack,
    Select,
    Badge,
} from "@shopify/polaris";
import { authenticate } from "app/shopify.server";
import { getStatisticsData, type StatisticsData } from "app/services/statistics.server";
import {
    LineChart,
    Line,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";

const currencyFormatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    month: "short",
    day: "numeric",
});

type LoaderData = StatisticsData;

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);

    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get("days") || "30", 10);

    const statistics = await getStatisticsData(days);

    return json<LoaderData>(statistics);
};

// Couleurs pour les graphiques
const COLORS = {
    primary: "#008060",
    secondary: "#0066CC",
    success: "#008060",
    warning: "#FFC453",
    critical: "#D72C0D",
    info: "#5C6AC4",
};

const PIE_COLORS = [COLORS.success, COLORS.warning, COLORS.critical];

export default function Statistics() {
    const data = useLoaderData<typeof loader>();

  return (
    <Page title="Statistiques">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" tone="subdued">
                Analyse complète du programme de parrainage avec graphiques et tendances. Visualisez l'évolution des parrains, des filleuls, des récompenses et identifiez les meilleurs parrains.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
                {/* Cartes de résumé */}
                <Layout.Section>
                    <BlockStack gap="400">
                        <Card>
                            <BlockStack gap="300">
                                <Text variant="headingMd" as="h2">
                                    Vue d'ensemble
                                </Text>
                                <InlineStack gap="400" align="space-between">
                                    <BlockStack gap="100">
                                        <Text variant="bodyMd" tone="subdued" as="p">
                                            Total parrains
                                        </Text>
                                        <Text variant="heading2xl" as="p">
                                            {data.summary.totalReferrers}
                                        </Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text variant="bodyMd" tone="subdued" as="p">
                                            Total codes
                                        </Text>
                                        <Text variant="heading2xl" as="p">
                                            {data.summary.totalCodes}
                                        </Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text variant="bodyMd" tone="subdued" as="p">
                                            Total filleuls
                                        </Text>
                                        <Text variant="heading2xl" as="p">
                                            {data.summary.totalReferrals}
                                        </Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text variant="bodyMd" tone="subdued" as="p">
                                            Récompenses payées
                                        </Text>
                                        <Text variant="heading2xl" as="p" tone="success">
                                            {currencyFormatter.format(data.summary.paidRewardsAmount)}
                                        </Text>
                                    </BlockStack>
                                    <BlockStack gap="100">
                                        <Text variant="bodyMd" tone="subdued" as="p">
                                            Récompenses en attente
                                        </Text>
                                        <Text variant="heading2xl" as="p" tone="caution">
                                            {currencyFormatter.format(data.summary.pendingRewardsAmount)}
                                        </Text>
                                    </BlockStack>
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </BlockStack>
                </Layout.Section>

                {/* Graphiques d'évolution temporelle */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">
                                Évolution des parrains
                            </Text>
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={data.referrersOverTime}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="date"
                                        tickFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <YAxis />
                                    <Tooltip
                                        labelFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <Legend />
                                    <Line
                                        type="monotone"
                                        dataKey="count"
                                        name="Nouveaux parrains"
                                        stroke={COLORS.primary}
                                        strokeWidth={2}
                                        dot={{ r: 4 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">
                                Évolution des filleuls
                            </Text>
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={data.referralsOverTime}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="date"
                                        tickFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <YAxis />
                                    <Tooltip
                                        labelFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <Legend />
                                    <Line
                                        type="monotone"
                                        dataKey="count"
                                        name="Nouveaux filleuls"
                                        stroke={COLORS.secondary}
                                        strokeWidth={2}
                                        dot={{ r: 4 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">
                                Évolution des récompenses
                            </Text>
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={data.rewardsOverTime}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="date"
                                        tickFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <YAxis />
                                    <Tooltip
                                        labelFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <Legend />
                                    <Line
                                        type="monotone"
                                        dataKey="count"
                                        name="Nouvelles récompenses"
                                        stroke={COLORS.success}
                                        strokeWidth={2}
                                        dot={{ r: 4 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">
                                Évolution des montants de récompenses
                            </Text>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={data.rewardsAmountOverTime}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="date"
                                        tickFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <YAxis
                                        tickFormatter={(value) =>
                                            value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value.toString()
                                        }
                                    />
                                    <Tooltip
                                        labelFormatter={(value) => dateFormatter.format(new Date(value))}
                                        formatter={(value: number) => currencyFormatter.format(value)}
                                    />
                                    <Legend />
                                    <Bar
                                        dataKey="amount"
                                        name="Montant (€)"
                                        fill={COLORS.success}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">
                                Utilisation des codes (cumulatif)
                            </Text>
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={data.codesUsageOverTime}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="date"
                                        tickFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <YAxis />
                                    <Tooltip
                                        labelFormatter={(value) => dateFormatter.format(new Date(value))}
                                    />
                                    <Legend />
                                    <Line
                                        type="monotone"
                                        dataKey="count"
                                        name="Utilisations totales"
                                        stroke={COLORS.info}
                                        strokeWidth={2}
                                        dot={{ r: 4 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* Graphiques de répartition */}
                <Layout.Section>
                    <InlineStack gap="400" align="start">
                        <Card>
                            <BlockStack gap="400">
                                <Text variant="headingMd" as="h2">
                                    Répartition des récompenses par statut
                                </Text>
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart>
                                        <Pie
                                            data={data.rewardsByStatus}
                                            dataKey="count"
                                            nameKey="status"
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={100}
                                            label={({ name, value }) =>
                                                `${name === "PENDING" ? "En attente" : name === "PAID" ? "Payée" : "Échouée"}: ${value}`
                                            }
                                        >
                                            {data.rewardsByStatus.map((entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend
                                            formatter={(value) =>
                                                value === "PENDING"
                                                    ? "En attente"
                                                    : value === "PAID"
                                                        ? "Payée"
                                                        : "Échouée"
                                            }
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <BlockStack gap="200">
                                    {data.rewardsByStatus.map((status, index) => (
                                        <InlineStack key={status.status} align="space-between">
                                            <Text as="span">
                                                {status.status === "PENDING"
                                                    ? "En attente"
                                                    : status.status === "PAID"
                                                        ? "Payée"
                                                        : "Échouée"}
                                            </Text>
                                            <InlineStack gap="200">
                                                <Text as="span" tone="subdued">
                                                    {status.count} récompense(s)
                                                </Text>
                                                <Badge
                                                    tone={
                                                        status.status === "PAID"
                                                            ? "success"
                                                            : status.status === "PENDING"
                                                                ? "attention"
                                                                : "critical"
                                                    }
                                                >
                                                    {currencyFormatter.format(status.amount)}
                                                </Badge>
                                            </InlineStack>
                                        </InlineStack>
                                    ))}
                                </BlockStack>
                            </BlockStack>
                        </Card>
                    </InlineStack>
                </Layout.Section>

                {/* Top parrains */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">
                                Top 10 parrains
                            </Text>
                            <ResponsiveContainer width="100%" height={400}>
                                <BarChart
                                    data={data.topReferrers}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        width={90}
                                        tick={{ fontSize: 12 }}
                                    />
                                    <Tooltip
                                        formatter={(value: number) => value}
                                        labelFormatter={(label) => `Parrain: ${label}`}
                                    />
                                    <Legend />
                                    <Bar dataKey="totalReferrals" name="Filleuls" fill={COLORS.primary} />
                                    <Bar dataKey="paidRewards" name="Récompenses payées (€)" fill={COLORS.success} />
                                    <Bar dataKey="pendingRewards" name="Récompenses en attente (€)" fill={COLORS.warning} />
                                </BarChart>
                            </ResponsiveContainer>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}

