import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { Page, Card, IndexTable, Text, Badge, Button, InlineStack, BlockStack, Banner } from "@shopify/polaris";
import { authenticate } from "app/shopify.server";
import { listRewards, processRewardRefund } from "app/services/rewards.server";

const currencyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

type LoaderData = {
  rewards: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
    paidAt: string | null;
    referrerId: string;
    referrerName: string;
    referrerEmail: string | null;
  }>;
  flash: { type: "success" | "error"; message: string } | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const hasSuccess = url.searchParams.get("success") === "1";
  const errorMessage = url.searchParams.get("error");

  const rewards = (await listRewards(200)).map((reward) => ({
    id: reward.id,
    amount: reward.amount,
    currency: reward.currency,
    status: reward.status,
    createdAt: reward.createdAt.toISOString(),
    paidAt: reward.paidAt ? reward.paidAt.toISOString() : null,
    referrerId: reward.referrerId,
    referrerName:
      [reward.referrer.firstName, reward.referrer.lastName]
        .filter(Boolean)
        .join(" ") || reward.referrer.email || reward.referrer.shopifyCustomerId,
    referrerEmail: reward.referrer.email,
  }));

  const flash = hasSuccess
    ? { type: "success" as const, message: "Refund accepté et récompense marquée comme payée." }
    : errorMessage
      ? { type: "error" as const, message: errorMessage }
      : null;

  return json<LoaderData>({ rewards, flash });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const rewardId = formData.get("rewardId");

  if (typeof rewardId !== "string" || !rewardId) {
    return redirect("/app/rewards?error=" + encodeURIComponent("Identifiant de récompense manquant."));
  }

  try {
    await processRewardRefund({
      rewardId,
      shopDomain: session?.shop,
    });
    return redirect("/app/rewards?success=1");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erreur inattendue lors du déclenchement du refund.";
    return redirect("/app/rewards?error=" + encodeURIComponent(message));
  }
};

export default function RewardsPage() {
  const { rewards, flash } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const rawRewardId = navigation.formData?.get("rewardId");
  const submittingRewardId = typeof rawRewardId === "string" ? rawRewardId : null;

  return (
    <Page title="Récompenses">
      <BlockStack gap="400">
        {flash && (
          <Banner tone={flash.type === "success" ? "success" : "critical"}>
            {flash.message}
          </Banner>
        )}
        <Card>
          <BlockStack gap="300">
            <Text variant="bodyMd" as="p" tone="subdued">
              Gestion des récompenses attribuées aux parrains. Consultez toutes les récompenses, leur statut (en attente, payée, échouée) et marquez-les comme payées lorsque les refunds ont été effectués.
            </Text>
          </BlockStack>
        </Card>
        <Card>
          <IndexTable
            resourceName={{ singular: "récompense", plural: "récompenses" }}
            itemCount={rewards.length}
            selectable={false}
            headings={[
              { title: "Parrain" },
              { title: "Montant" },
              { title: "Statut" },
              { title: "Demandé le" },
              { title: "Payée le" },
              { title: "" },
            ]}
          >
            {rewards.map((reward, index) => (
              <IndexTable.Row id={reward.id} key={reward.id} position={index}>
                <IndexTable.Cell>
                  <Text variant="bodyMd" fontWeight="bold" as="h3">
                    {reward.referrerName}
                  </Text>
                  {reward.referrerEmail && (
                    <Text variant="bodySm" as="p" tone="subdued">
                      {reward.referrerEmail}
                    </Text>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>{currencyFormatter.format(reward.amount)}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge
                    tone={
                      reward.status === "PAID"
                        ? "success"
                        : reward.status === "PENDING"
                          ? "attention"
                          : "critical"
                    }
                  >
                    {reward.status === "PAID"
                      ? "Payée"
                      : reward.status === "PENDING"
                        ? "En attente"
                        : "Erreur"}
                  </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{dateFormatter.format(new Date(reward.createdAt))}</IndexTable.Cell>
                <IndexTable.Cell>
                  {reward.paidAt ? dateFormatter.format(new Date(reward.paidAt)) : "—"}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {reward.status === "PENDING" ? (
                    <Form method="post">
                      <input type="hidden" name="rewardId" value={reward.id} />
                      <InlineStack gap="200">
                        <Button
                          variant="primary"
                          submit
                          disabled={isSubmitting}
                          loading={isSubmitting && submittingRewardId === reward.id}
                        >
                          Accepter refund
                        </Button>
                      </InlineStack>
                    </Form>
                  ) : null}
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
