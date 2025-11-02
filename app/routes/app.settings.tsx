import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";

import { authenticate } from "app/shopify.server";
import {
  getReferralSettings,
  updateReferralSettings,
  type ReferralSettings,
} from "app/services/settings.server";

type LoaderData = {
  settings: ReferralSettings;
  success: boolean;
};

type ActionData = {
  errors?: Partial<{
    discountPercentage: string;
    cashbackAmount: string;
    codeValidityDays: string;
    maxUsagePerCode: string;
    maxRefundPercentage: string;
    customerSegmentIds: string;
    form: string;
  }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [settings, success] = await Promise.all([
    getReferralSettings(),
    (async () => new URL(request.url).searchParams.get("success") === "1")(),
  ]);

  return json<LoaderData>({ settings, success });
};

function parseNumber(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseInteger(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) ? value : null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();

  const errors: NonNullable<ActionData["errors"]> = {};

  const discountPercentageRaw = formData.get("discountPercentage");
  const cashbackAmountRaw = formData.get("cashbackAmount");
  const codeValidityDaysRaw = formData.get("codeValidityDays");
  const maxUsagePerCodeRaw = formData.get("maxUsagePerCode");
  const maxRefundPercentageRaw = formData.get("maxRefundPercentage");
  const appliesOncePerCustomerRaw = formData.get("appliesOncePerCustomer");
  const customerSegmentIdsRaw = formData.get("customerSegmentIds");

  const discountPercentage = parseNumber(discountPercentageRaw);
  if (discountPercentage === null || discountPercentage < 0) {
    errors.discountPercentage = "Veuillez saisir un pourcentage valide (>= 0).";
  }

  const cashbackAmount = parseNumber(cashbackAmountRaw);
  if (cashbackAmount === null || cashbackAmount < 0) {
    errors.cashbackAmount = "Veuillez saisir un montant de cashback valide (>= 0).";
  }

  const codeValidityDays = parseInteger(codeValidityDaysRaw);
  if (codeValidityDays === null || codeValidityDays < 0) {
    errors.codeValidityDays = "Veuillez saisir une durée valide en jours (>= 0).";
  }

  let maxUsagePerCode: number | null = null;
  if (typeof maxUsagePerCodeRaw === "string" && maxUsagePerCodeRaw.trim() !== "") {
    maxUsagePerCode = parseInteger(maxUsagePerCodeRaw);
    if (maxUsagePerCode === null || maxUsagePerCode < 0) {
      errors.maxUsagePerCode = "Veuillez saisir un nombre d'utilisations valide (>= 0).";
    }
  }

  const maxRefundPercentage = parseNumber(maxRefundPercentageRaw);
  if (maxRefundPercentage === null || maxRefundPercentage < 0 || maxRefundPercentage > 100) {
    errors.maxRefundPercentage = "Veuillez saisir un pourcentage valide entre 0 et 100.";
  }

  const appliesOncePerCustomer = appliesOncePerCustomerRaw === "on" || appliesOncePerCustomerRaw === "true";

  const customerSegmentIds =
    typeof customerSegmentIdsRaw === "string"
      ? customerSegmentIdsRaw
        .split(/[\n,]/)
        .map((segment) => segment.trim())
        .filter(Boolean)
      : [];

  if (Object.keys(errors).length > 0) {
    return json<ActionData>({ errors }, { status: 400 });
  }

  await updateReferralSettings({
    discountPercentage: (discountPercentage ?? 0) / 100,
    cashbackAmount: cashbackAmount ?? 0,
    codeValidityDays: codeValidityDays ?? 0,
    appliesOncePerCustomer,
    maxUsagePerCode: maxUsagePerCode ?? 0,
    maxRefundPercentage: (maxRefundPercentage ?? 100) / 100,
    customerSegmentIds,
  });

  return redirect("/app/settings?success=1");
};

export default function SettingsPage() {
  const { settings, success } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const initialValues = useMemo(
    () => ({
      discountPercentage: (settings.discountPercentage * 100).toString(),
      cashbackAmount: settings.cashbackAmount.toString(),
      codeValidityDays: settings.codeValidityDays.toString(),
      appliesOncePerCustomer: settings.appliesOncePerCustomer,
      maxUsagePerCode: settings.maxUsagePerCode ? settings.maxUsagePerCode.toString() : "",
      maxRefundPercentage: (settings.maxRefundPercentage * 100).toString(),
      customerSegmentIds: settings.customerSegmentIds.join("\n"),
    }),
    [
      settings.discountPercentage,
      settings.cashbackAmount,
      settings.codeValidityDays,
      settings.appliesOncePerCustomer,
      settings.maxUsagePerCode,
      settings.maxRefundPercentage,
      settings.customerSegmentIds,
    ],
  );

  const [formValues, setFormValues] = useState(initialValues);
  const [showSuccess, setShowSuccess] = useState(success);

  useEffect(() => {
    setFormValues(initialValues);
  }, [initialValues]);

  useEffect(() => {
    setShowSuccess(success);
  }, [success]);

  const errors = actionData?.errors ?? {};

  return (
    <Page title="Paramètres du programme">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              Ajustez ici les paramètres globaux du programme de parrainage. Ces valeurs impactent les
              codes générés, les récompenses et les conditions d'usage.
            </Text>

            {showSuccess ? (
              <Banner
                title="Paramètres enregistrés"
                tone="success"
                onDismiss={() => setShowSuccess(false)}
              >
                <p>Les paramètres du programme ont été mis à jour avec succès.</p>
              </Banner>
            ) : null}

            {errors.form ? (
              <Banner tone="critical" title="Sauvegarde impossible">
                <p>{errors.form}</p>
              </Banner>
            ) : null}

            <Form method="post" replace>
              <Card>
                <BlockStack gap="300">
                  <TextField
                    label="Pourcentage de remise"
                    name="discountPercentage"
                    type="number"
                    step={0.1}
                    autoComplete=""
                    value={formValues.discountPercentage}
                    suffix="%"
                    onChange={(value) =>
                      setFormValues((prev) => ({ ...prev, discountPercentage: value }))
                    }
                    error={errors.discountPercentage}
                    helpText="Pourcentage appliqué sur le panier du filleul. Exemple : 10 pour 10 %."
                  />

                  <TextField
                    label="Montant du cashback"
                    name="cashbackAmount"
                    type="number"
                    step={0.5}
                    prefix="€"
                    value={formValues.cashbackAmount}
                    onChange={(value) =>
                      setFormValues((prev) => ({ ...prev, cashbackAmount: value }))
                    }
                    autoComplete=""
                    error={errors.cashbackAmount}
                    helpText="Montant versé au parrain pour chaque commande validée."
                  />

                  <TextField
                    label="Validité des codes"
                    name="codeValidityDays"
                    autoComplete=""
                    type="number"
                    min={0}
                    value={formValues.codeValidityDays}
                    suffix="jours"
                    onChange={(value) =>
                      setFormValues((prev) => ({ ...prev, codeValidityDays: value }))
                    }
                    error={errors.codeValidityDays}
                    helpText="Nombre de jours pendant lesquels un code reste utilisable. 0 = aucun expiration (infini)."
                  />

                  <input
                    type="hidden"
                    name="appliesOncePerCustomer"
                    value={formValues.appliesOncePerCustomer ? "on" : "off"}
                  />
                  <Checkbox
                    label="Limiter à un usage par filleul"
                    checked={formValues.appliesOncePerCustomer}
                    onChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, appliesOncePerCustomer: checked }))
                    }
                    helpText="Activez cette option pour éviter que le même client n'utilise plusieurs codes."
                  />

                  <TextField
                    autoComplete=""
                    label="Nombre maximal d'utilisations par code"
                    name="maxUsagePerCode"
                    type="number"
                    min={0}
                    value={formValues.maxUsagePerCode}
                    onChange={(value) =>
                      setFormValues((prev) => ({ ...prev, maxUsagePerCode: value }))
                    }
                    error={errors.maxUsagePerCode}
                    helpText="Laissez vide ou 0 pour autoriser un nombre illimité d'utilisations."
                  />

                  <TextField
                    autoComplete=""
                    label="Limite de refund par commande"
                    name="maxRefundPercentage"
                    type="number"
                    min={0}
                    max={100}
                    value={formValues.maxRefundPercentage}
                    suffix="%"
                    onChange={(value) =>
                      setFormValues((prev) => ({ ...prev, maxRefundPercentage: value }))
                    }
                    error={errors.maxRefundPercentage}
                    helpText="Pourcentage maximum de la commande originale qui peut être refundé via le système de parrainage. 100% = aucun limite."
                  />

                  <TextField
                    autoComplete=""
                    label="Segments clients ciblés"
                    name="customerSegmentIds"
                    value={formValues.customerSegmentIds}
                    onChange={(value) =>
                      setFormValues((prev) => ({ ...prev, customerSegmentIds: value }))
                    }
                    multiline
                    error={errors.customerSegmentIds}
                    helpText="IDs Shopify séparés par des virgules ou des retours à la ligne. Laissez vide pour tous les clients."
                  />

                  <InlineStack align="end">
                    <Button submit variant="primary" loading={isSubmitting} disabled={isSubmitting}>
                      Enregistrer
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Form>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}




