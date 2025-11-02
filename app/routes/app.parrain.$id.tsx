import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  IndexTable,
  BlockStack,
  InlineStack,
  ProgressBar,
  Button,
  Banner,
  Modal,
  ChoiceList,
  TextField,
  Pagination,
} from "@shopify/polaris";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { authenticate } from "app/shopify.server";
import { deleteReferrer, getReferrerDetail } from "app/services/referrers.server";
import { getTotalRefundedForCode, processRewardRefund } from "app/services/rewards.server";
import { getOrderTotalAmount } from "app/services/shopifyAdmin.server";
import { getReferralSettings } from "app/services/settings.server";
import { fetchShopifyDiscountDetails, recreateShopifyDiscount } from "app/services/discounts.server";
import prisma from "app/db.server";
import { listOrdersForCustomer, type SimplifiedOrder } from "app/services/orders.server";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const currencyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const percentageFormatter = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 0,
});

type ActionData = { success: true } | { error: string };
type LoaderData = {
  referrer: {
    id: string;
    name: string;
    email: string | null;
    shopifyCustomerId: string;
    createdAt: string;
    codes: Array<{
      id: string;
      code: string;
      createdAt: string;
      expiresAt: string | null;
      usageCount: number;
      maxUsage: number;
      shopifyDiscountId: string | null;
      workshopProductTitle: string | null;
      originOrderGid: string | null;
      refundProgress: {
        refunded: number;
        maxRefund: number | null;
        percentage: number;
      } | null;
    shopifyDiscount: {
      percentage: number | null;
      amountValue: number | null;
      amountCurrencyCode: string | null;
      usageLimit: number | null;
      appliesOncePerCustomer: boolean | null;
      startsAt: string | null;
      endsAt: string | null;
      status: string | null;
    } | null;
    snapshots: {
      discount: number | null;
      cashback: number | null;
    };
    }>;
    referrals: Array<{
      id: string;
      createdAt: string;
      refereeEmail: string | null;
      refereeFirstName: string | null;
      refereeLastName: string | null;
      orderId: string | null;
      code: string | null;
      workshopProductTitle: string | null;
      reward: {
        id: string;
        status: string;
        amount: number;
        currency: string;
      } | null;
    }>;
    rewards: Array<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      createdAt: string;
      paidAt: string | null;
    }>;
  };
  flash: { type: "success" | "error"; message: string } | null;
  orders: SimplifiedOrder[];
  settings: {
    discountPercentage: number;
    cashbackAmount: number;
    appliesOncePerCustomer: boolean;
    maxUsagePerCode: number;
    codeValidityDays: number;
  };
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const hasSuccess = url.searchParams.get("success") === "1";
  const errorMessage = url.searchParams.get("error");

  const referrerId = params.id;

  if (!referrerId) {
    throw new Response("Parrain non trouvé", { status: 404 });
  }

  const referrer = await getReferrerDetail(referrerId);

  if (!referrer) {
    throw new Response("Parrain non trouvé", { status: 404 });
  }

  const fullName = [referrer.firstName, referrer.lastName].filter(Boolean).join(" ") ||
    referrer.email ||
    referrer.shopifyCustomerId;

  const settings = await getReferralSettings();

  const discountIds = referrer.codes
    .map((code) => code.shopifyDiscountId ?? null)
    .filter((id): id is string => Boolean(id));

  const discountDetailsMap = await fetchShopifyDiscountDetails(discountIds, session?.shop);

  // Calculer la progression pour chaque code
  const codesWithProgress = await Promise.all(
    referrer.codes.map(async (code) => {
      const discountDetails = code.shopifyDiscountId
        ? discountDetailsMap[code.shopifyDiscountId] ?? null
        : null;

      if (!code.originOrderGid) {
        return {
          id: code.id,
          code: code.code,
          createdAt: code.createdAt.toISOString(),
          expiresAt: code.expiresAt ? code.expiresAt.toISOString() : null,
          usageCount: code.usageCount,
          maxUsage: code.maxUsage,
          shopifyDiscountId: code.shopifyDiscountId ?? null,
          workshopProductTitle: code.workshopProductTitle ?? null,
          originOrderGid: code.originOrderGid ?? null,
          refundProgress: null,
          shopifyDiscount: discountDetails,
          snapshots: {
            discount: code.discountSnapshot ?? null,
            cashback: code.cashbackSnapshot ?? null,
          },
        };
      }

      const totalRefunded = await getTotalRefundedForCode(code.originOrderGid);
      const orderTotal = await getOrderTotalAmount(code.originOrderGid);
      const maxRefund = orderTotal ? orderTotal * settings.maxRefundPercentage : null;
      const percentage = maxRefund && maxRefund > 0 ? Math.min((totalRefunded / maxRefund) * 100, 100) : 0;

      return {
        id: code.id,
        code: code.code,
        createdAt: code.createdAt.toISOString(),
        expiresAt: code.expiresAt ? code.expiresAt.toISOString() : null,
        usageCount: code.usageCount,
        maxUsage: code.maxUsage,
        shopifyDiscountId: code.shopifyDiscountId ?? null,
        workshopProductTitle: code.workshopProductTitle ?? null,
        originOrderGid: code.originOrderGid ?? null,
        refundProgress: {
          refunded: totalRefunded,
          maxRefund,
          percentage,
        },
        shopifyDiscount: discountDetails,
        snapshots: {
          discount: code.discountSnapshot ?? null,
          cashback: code.cashbackSnapshot ?? null,
        },
      };
    })
  );

  const orders = referrer.shopifyCustomerId
    ? await listOrdersForCustomer(referrer.shopifyCustomerId, session?.shop, { limit: 20 })
    : [];

  return json<LoaderData>({
    referrer: {
      id: referrer.id,
      name: fullName,
      email: referrer.email ?? null,
      shopifyCustomerId: referrer.shopifyCustomerId,
      createdAt: referrer.createdAt.toISOString(),
      codes: codesWithProgress,
      referrals: referrer.referrals.map((referral) => ({
        id: referral.id,
        createdAt: referral.createdAt.toISOString(),
        refereeEmail: referral.refereeEmail ?? null,
        refereeFirstName: referral.refereeFirstName ?? null,
        refereeLastName: referral.refereeLastName ?? null,
        orderId: referral.orderId ?? null,
        code: referral.code?.code ?? null,
        workshopProductTitle: referral.workshopProductTitle ?? null,
        reward: referral.reward
          ? {
            id: referral.reward.id,
            status: referral.reward.status,
            amount: referral.reward.amount,
            currency: referral.reward.currency,
          }
          : null,
      })),
      rewards: referrer.rewards.map((reward) => ({
        id: reward.id,
        status: reward.status,
        amount: reward.amount,
        currency: reward.currency,
        createdAt: reward.createdAt.toISOString(),
        paidAt: reward.paidAt ? reward.paidAt.toISOString() : null,
      })),
    },
    flash: hasSuccess
      ? { type: "success", message: "Refund accepté et envoyé." }
      : errorMessage
        ? { type: "error", message: errorMessage }
        : null,
    orders,
    settings: {
      discountPercentage: settings.discountPercentage,
      cashbackAmount: settings.cashbackAmount,
      appliesOncePerCustomer: settings.appliesOncePerCustomer,
      maxUsagePerCode: settings.maxUsagePerCode,
      codeValidityDays: settings.codeValidityDays,
    },
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const referrerId = params.id;
  if (!referrerId) {
    return redirect("/app/referrers?error=" + encodeURIComponent("Parrain introuvable."));
  }

  const formData = await request.formData();
  const intentRaw = formData.get("intent");
  const intent = typeof intentRaw === "string" ? intentRaw : null;
  const isFetcherRequest = request.headers.get("X-Remix-Request") === "fetcher";

  if (intent === "delete") {
    try {
      await deleteReferrer(referrerId, { shopDomain: session?.shop });
      return redirect(`/app/referrers?success=${encodeURIComponent("Parrain supprimé avec succès.")}`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible de supprimer le parrain pour le moment.";
      return redirect(`/app/parrain/${referrerId}?error=${encodeURIComponent(message)}`);
    }
  }

  if (intent === "sync-discount") {
    const codeIdRaw = formData.get("codeId");
    const codeId = typeof codeIdRaw === "string" ? codeIdRaw : null;

    if (!codeId) {
      const message = "Identifiant de code manquant.";
      if (isFetcherRequest) {
        return json<ActionData>({ error: message }, { status: 400 });
      }
      return redirect(`/app/parrain/${referrerId}?error=${encodeURIComponent(message)}`);
    }

    const code = await prisma.code.findUnique({ where: { id: codeId } });

    if (!code || code.referrerId !== referrerId) {
      const message = "Code introuvable pour ce parrain.";
      if (isFetcherRequest) {
        return json<ActionData>({ error: message }, { status: 404 });
      }
      return redirect(`/app/parrain/${referrerId}?error=${encodeURIComponent(message)}`);
    }

    if (!code.shopifyDiscountId) {
      const message = "Ce code n'est pas lié à un discount Shopify.";
      if (isFetcherRequest) {
        return json<ActionData>({ error: message }, { status: 400 });
      }
      return redirect(`/app/parrain/${referrerId}?error=${encodeURIComponent(message)}`);
    }

    try {
      const settings = await getReferralSettings();
      const discount = await recreateShopifyDiscount({
        code,
        settings,
        shopDomain: session?.shop,
      });

      if (!discount) {
        throw new Error("Impossible de synchroniser le discount Shopify.");
      }

      await prisma.code.update({
        where: { id: code.id },
        data: {
          shopifyDiscountId: discount.discountId,
          maxUsage: settings.maxUsagePerCode,
          discountSnapshot: settings.discountPercentage,
          cashbackSnapshot: settings.cashbackAmount,
        },
      });

      if (isFetcherRequest) {
        return json<ActionData>({ success: true });
      }

      return redirect(`/app/parrain/${referrerId}?success=1`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur inattendue lors de la synchronisation du discount.";
      if (isFetcherRequest) {
        return json<ActionData>({ error: message }, { status: 400 });
      }
      return redirect(`/app/parrain/${referrerId}?error=${encodeURIComponent(message)}`);
    }
  }

  const rewardId = formData.get("rewardId");
  const orderGidRaw = formData.get("orderGid");
  const orderGid =
    typeof orderGidRaw === "string" && orderGidRaw.trim().length > 0
      ? orderGidRaw.trim()
      : undefined;

  if (typeof rewardId !== "string" || !rewardId) {
    return redirect(`/app/parrain/${referrerId}?error=${encodeURIComponent("Identifiant de récompense manquant.")}`);
  }

  try {
    await processRewardRefund({
      rewardId,
      shopDomain: session?.shop,
      orderGidOverride: orderGid,
    });
    if (isFetcherRequest) {
      return json<ActionData>({ success: true });
    }
    return redirect(`/app/parrain/${referrerId}?success=1`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erreur inattendue lors du déclenchement du refund.";
    if (isFetcherRequest) {
      return json<ActionData>({ error: message }, { status: 400 });
    }
    return redirect(`/app/parrain/${referrerId}?error=${encodeURIComponent(message)}`);
  }
};

type ReferralsTableProps = {
  referrals: LoaderData["referrer"]["referrals"];
  codes: LoaderData["referrer"]["codes"];
  orders: LoaderData["orders"];
  refundFetcher: ReturnType<typeof useFetcher<ActionData>>;
  activeRewardId: string | null;
  setActiveRewardId: (id: string | null) => void;
  setSelectedOrderGid: (gid: string | null) => void;
  setOrderError: (error: string | null) => void;
};

function ReferralsTable({
  referrals,
  codes,
  orders,
  refundFetcher,
  activeRewardId,
  setActiveRewardId,
  setSelectedOrderGid,
  setOrderError,
}: ReferralsTableProps) {
  const [searchValue, setSearchValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 10;

  // Initialiser depuis l'URL si disponible
  useEffect(() => {
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const urlSearch = searchParams.get("searchReferrals") || "";
      const urlPage = Number.parseInt(searchParams.get("referralsPage") || "1", 10);
      setSearchValue(urlSearch);
      setCurrentPage(urlPage);
    }
  }, []);

  // Filtrer les filleuls selon la recherche
  const filteredReferrals = useMemo(() => {
    if (!searchValue.trim()) return referrals;

    const searchLower = searchValue.toLowerCase().trim();
    return referrals.filter((referral) => {
      const name = [referral.refereeFirstName, referral.refereeLastName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const email = (referral.refereeEmail || "").toLowerCase();
      const code = (referral.code || "").toLowerCase();
      const workshop = (referral.workshopProductTitle || "").toLowerCase();

      return (
        name.includes(searchLower) ||
        email.includes(searchLower) ||
        code.includes(searchLower) ||
        workshop.includes(searchLower)
      );
    });
  }, [referrals, searchValue]);

  // Paginer les résultats
  const paginatedReferrals = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    const end = start + perPage;
    return filteredReferrals.slice(start, end);
  }, [filteredReferrals, currentPage, perPage]);

  const totalPages = Math.ceil(filteredReferrals.length / perPage);

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
    setCurrentPage(1);
    const searchParams = new URLSearchParams(window.location.search);
    if (value.trim()) {
      searchParams.set("searchReferrals", value.trim());
    } else {
      searchParams.delete("searchReferrals");
    }
    searchParams.set("referralsPage", "1");
    window.history.replaceState({}, "", `${window.location.pathname}?${searchParams.toString()}`);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    setCurrentPage(1);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete("searchReferrals");
    searchParams.set("referralsPage", "1");
    window.history.replaceState({}, "", `${window.location.pathname}?${searchParams.toString()}`);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("referralsPage", String(page));
    window.history.replaceState({}, "", `${window.location.pathname}?${searchParams.toString()}`);
  }, []);

  return (
    <BlockStack gap="300">
      <TextField
        label="Rechercher un filleul"
        placeholder="Rechercher par nom, email, code ou workshop..."
        autoComplete="off"
        value={searchValue}
        onChange={handleSearchChange}
        clearButton
        onClearButtonClick={handleSearchClear}
      />
      {searchValue && (
        <Text variant="bodySm" tone="subdued" as="p">
          {filteredReferrals.length} filleul{filteredReferrals.length > 1 ? "s" : ""} trouvé{filteredReferrals.length > 1 ? "s" : ""}
        </Text>
      )}
      <IndexTable
        resourceName={{ singular: "filleul", plural: "filleuls" }}
        itemCount={paginatedReferrals.length}
        headings={[
          { title: "Date" },
          { title: "Nom" },
          { title: "Email" },
          { title: "Workshop" },
          { title: "Code utilisé" },
          { title: "Récompense" },
          { title: "Actions" },
        ]}
        selectable={false}
      >
        {paginatedReferrals.map((referral, index) => (
          <IndexTable.Row id={referral.id} key={referral.id} position={index}>
            <IndexTable.Cell>
              {dateFormatter.format(new Date(referral.createdAt))}
            </IndexTable.Cell>
            <IndexTable.Cell>
              {referral.refereeFirstName || referral.refereeLastName ? (
                <Text variant="bodyMd" as="span">
                  {[referral.refereeFirstName, referral.refereeLastName].filter(Boolean).join(" ")}
                </Text>
              ) : (
                "—"
              )}
            </IndexTable.Cell>
            <IndexTable.Cell>{referral.refereeEmail ?? "—"}</IndexTable.Cell>
            <IndexTable.Cell>{referral.workshopProductTitle ?? "—"}</IndexTable.Cell>
            <IndexTable.Cell>{referral.code ?? "—"}</IndexTable.Cell>
            <IndexTable.Cell>
              {referral.reward ? (
                <Badge
                  tone={
                    referral.reward.status === "PAID"
                      ? "success"
                      : referral.reward.status === "PENDING"
                        ? "attention"
                        : "critical"
                  }
                >
                  {currencyFormatter.format(referral.reward.amount)}
                </Badge>
              ) : (
                "—"
              )}
            </IndexTable.Cell>
            <IndexTable.Cell>
              {referral.reward && referral.reward.status === "PENDING" ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    let defaultOrderGid: string | null = null;

                    if (referral.code) {
                      const relatedCode = codes.find(
                        (code) => code.code === referral.code,
                      );
                      if (relatedCode?.originOrderGid) {
                        defaultOrderGid = relatedCode.originOrderGid;
                      }
                    }

                    if (!defaultOrderGid && orders.length > 0) {
                      defaultOrderGid = orders[0].gid;
                    }

                    setSelectedOrderGid(defaultOrderGid);
                    setActiveRewardId(referral.reward?.id ?? null);
                    setOrderError(null);
                  }}
                  disabled={refundFetcher.state === "submitting"}
                  loading={
                    refundFetcher.state === "submitting" &&
                    activeRewardId === referral.reward?.id
                  }
                >
                  Accepter refund
                </Button>
              ) : (
                "—"
              )}
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
      {totalPages > 1 && (
        <div style={{ padding: "16px 0" }}>
          <Pagination
            label={`Page ${currentPage} sur ${totalPages}`}
            hasPrevious={currentPage > 1}
            onPrevious={() => handlePageChange(currentPage - 1)}
            hasNext={currentPage < totalPages}
            onNext={() => handlePageChange(currentPage + 1)}
          />
        </div>
      )}
    </BlockStack>
  );
}

export default function ReferrerDetail() {
  const { referrer, flash, orders, settings } = useLoaderData<typeof loader>();
  const refundFetcher = useFetcher<ActionData>();
  const discountSyncFetcher = useFetcher<ActionData>();
  const isModalSubmitting = refundFetcher.state === "submitting";
  const [activeRewardId, setActiveRewardId] = useState<string | null>(null);
  const [selectedOrderGid, setSelectedOrderGid] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [syncingCodeId, setSyncingCodeId] = useState<string | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [detailCodeId, setDetailCodeId] = useState<string | null>(null);
  const activeReferral = useMemo(() => {
    if (!activeRewardId) return null;
    return referrer.referrals.find(
      (referral) => referral.reward && referral.reward.id === activeRewardId,
    );
  }, [activeRewardId, referrer.referrals]);

  const isModalOpen = activeRewardId !== null;

  const getCodeStatus = useCallback(
    (code: LoaderData["referrer"]["codes"][number]) => {
      const discountPercentage = code.shopifyDiscount?.percentage ?? null;
      const hasDiscountInfo = code.shopifyDiscount !== null && code.shopifyDiscount !== undefined;
      const discountAligned = hasDiscountInfo
        ? discountPercentage !== null
          ? Math.abs(discountPercentage - settings.discountPercentage) < 0.0001
          : false
        : null;

      const maxUsageShopify =
        code.shopifyDiscount?.usageLimit ?? (code.maxUsage > 0 ? code.maxUsage : null);
      const usageAligned =
        (maxUsageShopify === null || maxUsageShopify === undefined) && settings.maxUsagePerCode === 0
          ? true
          : maxUsageShopify !== null && maxUsageShopify === settings.maxUsagePerCode;

      const appliesOnceAligned =
        code.shopifyDiscount?.appliesOncePerCustomer === null ||
        code.shopifyDiscount?.appliesOncePerCustomer === undefined
          ? null
          : code.shopifyDiscount.appliesOncePerCustomer === settings.appliesOncePerCustomer;

      const cashbackSnapshot = code.snapshots.cashback;
      const cashbackAligned =
        cashbackSnapshot === null || cashbackSnapshot === undefined
          ? null
          : Math.abs(cashbackSnapshot - settings.cashbackAmount) < 0.01;

      const mismatches: string[] = [];
      if (discountAligned === false) {
        mismatches.push("Remise");
      } else if (discountAligned === null) {
        mismatches.push("Remise inconnue");
      }
      if (!usageAligned) {
        mismatches.push("Usage max");
      }
      if (appliesOnceAligned === false) {
        mismatches.push("Limite client");
      }
      if (cashbackAligned === false) {
        mismatches.push("Cashback");
      }

      const needsSync =
        discountAligned === null ||
        discountAligned === false ||
        !usageAligned ||
        appliesOnceAligned === false ||
        cashbackAligned === false;

      return {
        discountAligned,
        usageAligned,
        appliesOnceAligned,
        cashbackAligned,
        maxUsageShopify,
        mismatches,
        needsSync,
        badgeTone: mismatches.length === 0 ? "success" : "attention",
        badgeLabel: mismatches.length === 0 ? "À jour" : "À vérifier",
        summary: mismatches.length === 0 ? "Synchronisé" : mismatches.join(" • "),
      } as const;
    },
    [
      settings.appliesOncePerCustomer,
      settings.cashbackAmount,
      settings.discountPercentage,
      settings.maxUsagePerCode,
    ],
  );

  const detailCode = useMemo(() => {
    if (!detailCodeId) return null;
    return referrer.codes.find((code) => code.id === detailCodeId) ?? null;
  }, [detailCodeId, referrer.codes]);

  const detailStatus = detailCode ? getCodeStatus(detailCode) : null;

  const handleSyncDiscount = useCallback(
    (codeId: string) => {
      setSyncingCodeId(codeId);
      setDiscountError(null);
      discountSyncFetcher.submit(
        { intent: "sync-discount", codeId },
        { method: "post" },
      );
    },
    [discountSyncFetcher],
  );

  useEffect(() => {
    if (refundFetcher.state === "idle" && refundFetcher.data) {
      if ("success" in refundFetcher.data && refundFetcher.data.success) {
        setActiveRewardId(null);
        setSelectedOrderGid(null);
        setOrderError(null);
        window.location.reload();
      } else if ("error" in refundFetcher.data) {
        setOrderError(refundFetcher.data.error);
      }
    }
  }, [refundFetcher.state, refundFetcher.data]);

  useEffect(() => {
    if (discountSyncFetcher.state === "idle" && discountSyncFetcher.data) {
      if ("success" in discountSyncFetcher.data && discountSyncFetcher.data.success) {
        setSyncingCodeId(null);
        setDiscountError(null);
        window.location.reload();
      } else if ("error" in discountSyncFetcher.data) {
        setDiscountError(discountSyncFetcher.data.error);
        setSyncingCodeId(null);
      }
    }
  }, [discountSyncFetcher.state, discountSyncFetcher.data]);

  return (
    <Page
      title={`Parrain : ${referrer.name}`}
      backAction={{ content: "Retour", url: "/app/referrers" }}
    >
      {flash && (
        <Banner tone={flash.type === "success" ? "success" : "critical"}>
          {flash.message}
        </Banner>
      )}
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p" tone="subdued">
                Détails complets d'un parrain : ses codes de parrainage, ses filleuls, ses récompenses et la progression des refunds pour chaque code.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <div>
                <Text as="h2" variant="headingMd">
                  Informations
                </Text>
                <Text as="p">Email : {referrer.email ?? "—"}</Text>
                <Text as="p">Client Shopify : {referrer.shopifyCustomerId}</Text>
                <Text as="p">Créé le : {dateFormatter.format(new Date(referrer.createdAt))}</Text>
              </div>
              <Form
                method="post"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  if (
                    !window.confirm(
                      "Supprimer ce parrain supprimera ses codes, filleuls et récompenses. Continuer ?",
                    )
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="intent" value="delete" />
                <Button
                  tone="critical"
                  variant="secondary"
                  submit
                >
                  Supprimer ce parrain
                </Button>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              {discountError && (
                <Banner tone="critical" onDismiss={() => setDiscountError(null)}>
                  {discountError}
                </Banner>
              )}
            <IndexTable
              resourceName={{ singular: "code", plural: "codes" }}
              itemCount={referrer.codes.length}
              headings={[
                { title: "Code" },
                { title: "Workshop" },
                { title: "Créé le" },
                { title: "Expiration" },
                { title: "Utilisations" },
                { title: "Progression refund" },
                { title: "Statut" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {referrer.codes.map((code, index) => {
                const status = getCodeStatus(code);

                return (
                <IndexTable.Row id={code.id} key={code.id} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                      {code.code}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {code.workshopProductTitle ?? "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {dateFormatter.format(new Date(code.createdAt))}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {code.expiresAt ? dateFormatter.format(new Date(code.expiresAt)) : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {code.maxUsage > 0 ? `${code.usageCount} / ${code.maxUsage}` : code.usageCount}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {code.refundProgress ? (
                      <BlockStack gap="200">
                        <Text variant="bodySm" as="span">
                          {code.refundProgress.percentage.toFixed(1)}%
                        </Text>
                        <ProgressBar
                          progress={code.refundProgress.percentage}
                          size="small"
                        />
                        {code.refundProgress.maxRefund && (
                          <Text variant="bodySm" as="p" tone="subdued">
                            {currencyFormatter.format(code.refundProgress.refunded)} / {currencyFormatter.format(code.refundProgress.maxRefund)}
                          </Text>
                        )}
                      </BlockStack>
                    ) : (
                      "—"
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="100">
                      <InlineStack gap="100" align="start" blockAlign="center">
                        <Badge tone={status.badgeTone}>{status.badgeLabel}</Badge>
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued" as="span">
                        {status.summary}
                      </Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button
                      variant="secondary"
                      size="slim"
                      onClick={() => {
                        setDetailCodeId(code.id);
                        setDiscountError(null);
                      }}
                    >
                      Détails
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
                );
              })}
            </IndexTable>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <ReferralsTable
              referrals={referrer.referrals}
              codes={referrer.codes}
              orders={orders}
              refundFetcher={refundFetcher}
              activeRewardId={activeRewardId}
              setActiveRewardId={setActiveRewardId}
              setSelectedOrderGid={setSelectedOrderGid}
              setOrderError={setOrderError}
            />
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <IndexTable
              resourceName={{ singular: "récompense", plural: "récompenses" }}
              itemCount={referrer.rewards.length}
              headings={[
                { title: "Date" },
                { title: "Montant" },
                { title: "Statut" },
                { title: "Payée le" },
              ]}
              selectable={false}
            >
              {referrer.rewards.map((reward, index) => (
                <IndexTable.Row id={reward.id} key={reward.id} position={index}>
                  <IndexTable.Cell>
                    {dateFormatter.format(new Date(reward.createdAt))}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {currencyFormatter.format(reward.amount)}
                  </IndexTable.Cell>
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
                  <IndexTable.Cell>
                    {reward.paidAt ? dateFormatter.format(new Date(reward.paidAt)) : "—"}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      {detailCode && (
        <Modal
          open
          onClose={() => setDetailCodeId(null)}
          title={`Code ${detailCode.code}`}
          primaryAction={
            detailStatus?.needsSync
              ? {
                  content: "Aligner sur les paramètres",
                  onAction: () => handleSyncDiscount(detailCode.id),
                  loading:
                    syncingCodeId === detailCode.id && discountSyncFetcher.state !== "idle",
                  disabled:
                    discountSyncFetcher.state !== "idle" &&
                    syncingCodeId !== detailCode.id,
                }
              : undefined
          }
          secondaryActions={[
            {
              content: "Fermer",
              onAction: () => setDetailCodeId(null),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <InlineStack gap="200" align="start" blockAlign="center">
                <Badge tone={detailStatus?.badgeTone ?? "subdued"}>
                  {detailStatus?.badgeLabel ?? "Informations indisponibles"}
                </Badge>
                {detailStatus?.summary ? (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {detailStatus.summary}
                  </Text>
                ) : null}
              </InlineStack>

              {discountError && (
                <Banner tone="critical" onDismiss={() => setDiscountError(null)}>
                  {discountError}
                </Banner>
              )}

              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">
                  Remise filleul
                </Text>
                <Text variant="bodyMd">
                  Shopify :{" "}
                  {detailCode.shopifyDiscount?.percentage !== null &&
                  detailCode.shopifyDiscount?.percentage !== undefined
                    ? percentageFormatter.format(detailCode.shopifyDiscount.percentage)
                    : detailCode.shopifyDiscount?.amountValue !== null &&
                        detailCode.shopifyDiscount?.amountValue !== undefined
                      ? `${currencyFormatter.format(detailCode.shopifyDiscount.amountValue)}${
                          detailCode.shopifyDiscount?.amountCurrencyCode
                            ? ` ${detailCode.shopifyDiscount.amountCurrencyCode}`
                            : ""
                        }`
                      : "—"}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Paramètre global : {percentageFormatter.format(settings.discountPercentage)}
                </Text>
                {detailCode.snapshots.discount !== null &&
                detailCode.snapshots.discount !== undefined ? (
                  <Text variant="bodySm" tone="subdued">
                    Valeur initiale : {percentageFormatter.format(detailCode.snapshots.discount)}
                  </Text>
                ) : null}
                {!detailCode.shopifyDiscount && (
                  <Text variant="bodySm" tone="critical">
                    Ce code n'est pas lié à un discount Shopify actif.
                  </Text>
                )}
              </BlockStack>

              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">
                  Usage et limites
                </Text>
                <Text variant="bodyMd">
                  Usage max Shopify :{" "}
                  {detailStatus?.maxUsageShopify !== null &&
                  detailStatus?.maxUsageShopify !== undefined
                    ? detailStatus.maxUsageShopify
                    : "Illimité"}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Paramètre global :{" "}
                  {settings.maxUsagePerCode > 0 ? settings.maxUsagePerCode : "Illimité"}
                </Text>
                {detailCode.shopifyDiscount?.appliesOncePerCustomer !== null &&
                detailCode.shopifyDiscount?.appliesOncePerCustomer !== undefined ? (
                  <Text variant="bodySm" tone="subdued">
                    Limite par client Shopify :{" "}
                    {detailCode.shopifyDiscount.appliesOncePerCustomer ? "Oui" : "Non"} (paramètre :{" "}
                    {settings.appliesOncePerCustomer ? "Oui" : "Non"})
                  </Text>
                ) : null}
              </BlockStack>

              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">
                  Cashback parrain
                </Text>
                <Text variant="bodyMd">
                  Historique code :{" "}
                  {detailCode.snapshots.cashback !== null &&
                  detailCode.snapshots.cashback !== undefined
                    ? currencyFormatter.format(detailCode.snapshots.cashback)
                    : "—"}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Paramètre global : {currencyFormatter.format(settings.cashbackAmount)}
                </Text>
              </BlockStack>

              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">
                  Infos Shopify
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Statut : {detailCode.shopifyDiscount?.status ?? "—"}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Début :{" "}
                  {detailCode.shopifyDiscount?.startsAt
                    ? dateFormatter.format(new Date(detailCode.shopifyDiscount.startsAt))
                    : "—"}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Fin :{" "}
                  {detailCode.shopifyDiscount?.endsAt
                    ? dateFormatter.format(new Date(detailCode.shopifyDiscount.endsAt))
                    : "—"}
                </Text>
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      <Modal
        open={isModalOpen}
        onClose={() => {
          if (isModalSubmitting) return;
          setActiveRewardId(null);
          setSelectedOrderGid(null);
          setOrderError(null);
        }}
        title="Sélectionner une commande à rembourser"
        primaryAction={{
          content: "Rembourser",
          onAction: () => {
            if (!selectedOrderGid) {
              setOrderError("Sélectionne la commande à rembourser.");
              return;
            }
            refundFetcher.submit(
              {
                rewardId: activeRewardId ?? "",
                orderGid: selectedOrderGid ?? "",
              },
              { method: "post" },
            );
          },
          loading: isModalSubmitting,
          disabled: isModalSubmitting || orders.length === 0,
        }}
        secondaryActions={[
          {
            content: "Annuler",
            onAction: () => {
              if (isModalSubmitting) return;
              setActiveRewardId(null);
              setSelectedOrderGid(null);
              setOrderError(null);
            },
            disabled: isModalSubmitting,
          },
        ]}
      >
        <div style={{ padding: "16px 20px" }}>
          <BlockStack gap="300">
            {activeReferral?.reward ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                Refund de {currencyFormatter.format(activeReferral.reward.amount)} pour{" "}
                {referrer.email ?? referrer.shopifyCustomerId}.
              </Text>
            ) : null}

            {orders.length === 0 ? (
              <Banner tone="warning">
                Aucune commande trouvée pour ce parrain sur Shopify. Il doit avoir acheté pour déclencher un remboursement.
              </Banner>
            ) : (
              <ChoiceList
                title="Commandes Shopify"
                choices={orders.map((order) => {
                  const refundInfo =
                    order.totalRefunds > 0
                      ? `Remboursé: ${order.totalRefunds.toFixed(2)} ${order.currency}`
                      : undefined;
                  return {
                    label: `${order.name} — ${new Date(order.createdAt).toLocaleDateString("fr-FR")} — ${order.total.toFixed(2)} ${order.currency}`,
                    value: order.gid,
                    helpText: refundInfo,
                  };
                })}
                selected={selectedOrderGid ? [selectedOrderGid] : []}
                onChange={(value) => {
                  setSelectedOrderGid(value[0] ?? null);
                  setOrderError(null);
                }}
              />
            )}

            {orderError ? (
              <Banner tone="critical">
                {orderError}
              </Banner>
            ) : null}
          </BlockStack>
        </div>
      </Modal>
    </Page>
  );
}
