import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, IndexTable, Text, Button, BlockStack, InlineStack, Layout, Badge } from "@shopify/polaris";
import { authenticate } from "app/shopify.server";
import prisma from "app/db.server";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
});

type LoaderData = {
    workshops: Array<{
        workshopProductTitle: string;
        participants: Array<{
            id: string;
            name: string;
            email: string | null;
            shopifyCustomerId: string;
            purchaseDate: string;
            code: string | null;
            quantity: number;
            emailStatus: "SENT" | "PENDING" | "FAILED" | "NO_EMAIL" | null;
            emailSentAt: string | null;
            emailError: string | null;
        }>;
    }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);

    // Récupérer tous les codes avec leurs workshops (tous les participants)
    const codesWithWorkshops = await prisma.code.findMany({
        where: {
            workshopProductTitle: {
                not: null,
            },
        },
        include: {
            referrer: true,
            emailLogs: {
                where: {
                    templateType: "CODE_PROMO",
                },
                orderBy: {
                    createdAt: "desc",
                },
                take: 1,
            },
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    // Grouper par workshop
    const workshopsMap = new Map<string, LoaderData["workshops"][0]>();

    for (const code of codesWithWorkshops) {
        const workshopTitle = code.workshopProductTitle!;

        if (!workshopsMap.has(workshopTitle)) {
            workshopsMap.set(workshopTitle, {
                workshopProductTitle: workshopTitle,
                participants: [],
            });
        }

        const workshop = workshopsMap.get(workshopTitle)!;
        const fullName = [code.referrer.firstName, code.referrer.lastName].filter(Boolean).join(" ") ||
            code.referrer.email ||
            code.referrer.shopifyCustomerId;

        const latestEmailLog = code.emailLogs[0];
        let emailStatus: "SENT" | "PENDING" | "FAILED" | "NO_EMAIL" | null = null;
        let emailSentAt: string | null = null;
        let emailError: string | null = null;

        if (!code.referrer.email) {
            emailStatus = "NO_EMAIL";
        } else if (latestEmailLog) {
            emailStatus = latestEmailLog.status as "SENT" | "PENDING" | "FAILED";
            emailSentAt = latestEmailLog.sentAt?.toISOString() ?? null;
            emailError = latestEmailLog.errorMessage ?? null;
        }

        workshop.participants.push({
            id: code.referrer.id,
            name: fullName,
            email: code.referrer.email,
            shopifyCustomerId: code.referrer.shopifyCustomerId,
            purchaseDate: code.createdAt.toISOString(),
            code: code.code,
            quantity: (code as any).workshopQuantity ?? 1,
            emailStatus,
            emailSentAt,
            emailError,
        });
    }

    const workshops = Array.from(workshopsMap.values()).map((w) => ({
        ...w,
        participants: w.participants.sort((a, b) =>
            new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime()
        ),
    }));

    return json<LoaderData>({ workshops });
};

function exportToCSV(workshopTitle: string, participants: LoaderData["workshops"][0]["participants"]) {
    const headers = ["Nom", "Email", "ID Shopify", "Date d'achat", "Code", "Nombre de places"];
    const rows = participants.map((p) => [
        p.name,
        p.email || "",
        p.shopifyCustomerId,
        dateFormatter.format(new Date(p.purchaseDate)),
        p.code || "",
        p.quantity.toString(),
    ]);

    const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" }); // BOM pour Excel
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workshop_${workshopTitle.replace(/[^a-zA-Z0-9]/g, "_")}_participants.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export default function WorkshopsPage() {
    const { workshops } = useLoaderData<typeof loader>();

    return (
        <Page title="Workshops">
            <BlockStack gap="400">
                <Card>
                    <BlockStack gap="200">
                        <Text variant="bodyMd" as="p" tone="subdued">
                            Liste des workshops avec leurs participants. Consultez qui a acheté chaque workshop, le nombre de places achetées, le statut d'envoi des emails, et exportez les données en CSV pour une gestion externe.
                        </Text>
                    </BlockStack>
                </Card>

                {workshops.length === 0 ? (
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">
                                Aucun workshop trouvé
                            </Text>
                            <Text as="p" tone="subdued">
                                Les workshops apparaîtront ici une fois que des participants auront acheté des produits.
                            </Text>
                        </BlockStack>
                    </Card>
                ) : (
                    workshops.map((workshop) => (
                        <Card key={workshop.workshopProductTitle}>
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text variant="headingLg" as="h2">
                                        {workshop.workshopProductTitle}
                                    </Text>
                                    <Button
                                        variant="primary"
                                        onClick={() => exportToCSV(workshop.workshopProductTitle, workshop.participants)}
                                    >
                                        Exporter CSV ({workshop.participants.length.toString()} participant{workshop.participants.length > 1 ? "s" : ""})
                                    </Button>
                                </InlineStack>

                                <IndexTable
                                    resourceName={{ singular: "participant", plural: "participants" }}
                                    itemCount={workshop.participants.length}
                                    headings={[
                                        { title: "Nom" },
                                        { title: "Email" },
                                        { title: "Date d'achat" },
                                        { title: "Nombre de places" },
                                        { title: "Statut Email" },
                                    ]}
                                    selectable={false}
                                >
                                    {workshop.participants.map((participant, index) => {
                                        let statusBadge = null;
                                        if (participant.emailStatus === "SENT") {
                                            statusBadge = <Badge status="success">Envoyé</Badge>;
                                        } else if (participant.emailStatus === "PENDING") {
                                            statusBadge = <Badge status="attention">En attente</Badge>;
                                        } else if (participant.emailStatus === "FAILED") {
                                            statusBadge = <Badge status="critical">Échec</Badge>;
                                        } else if (participant.emailStatus === "NO_EMAIL") {
                                            statusBadge = <Badge tone="info">Pas d'email</Badge>;
                                        } else {
                                            statusBadge = <Badge tone="subdued">Non envoyé</Badge>;
                                        }

                                        return (
                                            <IndexTable.Row id={participant.id} key={`${participant.id}-${index}`} position={index}>
                                                <IndexTable.Cell>
                                                    <Text variant="bodyMd" fontWeight="bold" as="span">
                                                        {participant.name}
                                                    </Text>
                                                </IndexTable.Cell>
                                                <IndexTable.Cell>{participant.email ?? "—"}</IndexTable.Cell>
                                                <IndexTable.Cell>
                                                    {dateFormatter.format(new Date(participant.purchaseDate))}
                                                </IndexTable.Cell>
                                                <IndexTable.Cell>
                                                    {participant.quantity}
                                                </IndexTable.Cell>
                                                <IndexTable.Cell>
                                                    <BlockStack gap="050">
                                                        {statusBadge}
                                                        {participant.emailSentAt && (
                                                            <Text variant="bodySm" tone="subdued" as="span">
                                                                {dateFormatter.format(new Date(participant.emailSentAt))}
                                                            </Text>
                                                        )}
                                                        {participant.emailError && (
                                                            <Text variant="bodySm" tone="critical" as="span">
                                                                {participant.emailError}
                                                            </Text>
                                                        )}
                                                    </BlockStack>
                                                </IndexTable.Cell>
                                            </IndexTable.Row>
                                        );
                                    })}
                                </IndexTable>
                            </BlockStack>
                        </Card>
                    ))
                )}
            </BlockStack>
        </Page>
    );
}

