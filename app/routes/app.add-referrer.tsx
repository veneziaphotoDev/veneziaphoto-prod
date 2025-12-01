import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  TextField,
  Button,
  Banner,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

import { authenticate } from "app/shopify.server";
import { getOrCreateCustomerByEmail } from "app/services/customers.server";
import { getOrCreateReferrerFromCustomer } from "app/services/referrers.server";
import { getReferralSettings } from "app/services/settings.server";
import { createCodeForReferrer, linkShopifyDiscountId } from "app/services/codes.server";
import { recreateShopifyDiscount } from "app/services/discounts.server";
import prisma from "app/db.server";
import { sendManualReferrerWelcomeEmail } from "app/services/email.server";

function computeExpiryDate(codeValidityDays: number): Date | null {
  if (!codeValidityDays || codeValidityDays <= 0) {
    return null;
  }
  const expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + codeValidityDays);
  return expiry;
}

type ActionData =
  | {
      success: true;
      message: string;
      referrerId: string;
      code: string;
      customerCreated: boolean;
      referrerCreated: boolean;
      existingCodesBefore: number;
      discountCreated: boolean;
      discountError?: string | null;
      customerShopifyId: string;
      welcomeEmailSent: boolean;
      welcomeEmailError?: string | null;
    }
  | { success?: false; error: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

function validateEmail(value: string | null): string | null {
  if (!value) return "L'email est obligatoire.";
  const email = value.trim().toLowerCase();
  if (!email) return "L'email est obligatoire.";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return "Format d'email invalide.";
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const firstNameRaw = formData.get("firstName");
  const lastNameRaw = formData.get("lastName");
  const emailRaw = formData.get("email");

  const firstName = typeof firstNameRaw === "string" ? firstNameRaw.trim() : "";
  const lastName = typeof lastNameRaw === "string" ? lastNameRaw.trim() : "";
  const emailError = validateEmail(typeof emailRaw === "string" ? emailRaw : null);

  if (emailError) {
    return json<ActionData>({ error: emailError }, { status: 400 });
  }

  const email = String(emailRaw).trim().toLowerCase();

  try {
    const { customer, created } = await getOrCreateCustomerByEmail(
      {
        email,
        firstName: firstName || null,
        lastName: lastName || null,
      },
      session?.shop,
    );

    const existingReferrerBefore = await prisma.referrer.findUnique({
      where: { shopifyCustomerId: customer.id },
    });

    const referrer = await getOrCreateReferrerFromCustomer({
      id: customer.id,
      email: customer.email,
      first_name: firstName || customer.firstName || null,
      last_name: lastName || customer.lastName || null,
    });

    const existingCodesBefore = await prisma.code.count({
      where: { referrerId: referrer.id },
    });

    const settings = await getReferralSettings();

    let codeRecord = null;
    let codeAlreadyExists = false;
    let discountCreated = false;
    let discountError: string | null = null;
    let welcomeEmailSent = false;
    let welcomeEmailError: string | null = null;

    if (existingCodesBefore > 0) {
      codeAlreadyExists = true;
      const latestCode = await prisma.code.findFirst({
        where: { referrerId: referrer.id },
        orderBy: { createdAt: "desc" },
      });

      if (latestCode) {
        codeRecord = await prisma.code.update({
          where: { id: latestCode.id },
          data: {
            expiresAt: computeExpiryDate(settings.codeValidityDays) ?? undefined,
            maxUsage: settings.maxUsagePerCode,
            discountSnapshot: settings.discountPercentage,
            cashbackSnapshot: settings.cashbackAmount,
          },
        });
      }
    }

    if (!codeRecord) {
      codeRecord = await createCodeForReferrer({
        referrerId: referrer.id,
        settings,
        sendEmail: false,
      });
    } else {
      codeRecord = await prisma.code.update({
        where: { id: codeRecord.id },
        data: {
          expiresAt: computeExpiryDate(settings.codeValidityDays) ?? undefined,
          maxUsage: settings.maxUsagePerCode,
          discountSnapshot: settings.discountPercentage,
          cashbackSnapshot: settings.cashbackAmount,
        },
      });
    }

    if (!codeRecord) {
      discountError = "Impossible de récupérer ou créer un code de parrainage.";
    } else {
      const discount = await recreateShopifyDiscount({
        code: codeRecord,
        settings,
        shopDomain: session?.shop,
      });

      if (discount) {
        await linkShopifyDiscountId(codeRecord.id, discount.discountId);
        discountCreated = true;
      } else if (!discountError) {
        discountError = codeAlreadyExists
          ? "Impossible de mettre à jour le discount Shopify."
          : "Impossible de créer le discount Shopify.";
      }
    }

    const shopUrl = session?.shop ? `https://${session.shop}` : undefined;

    const shouldSendWelcome =
      codeRecord?.code && (!codeAlreadyExists || !existingReferrerBefore);

    if (shouldSendWelcome) {
      if (referrer.email) {
        try {
          await sendManualReferrerWelcomeEmail({
            referrerId: referrer.id,
            referrerEmail: referrer.email,
            firstName: referrer.firstName,
            lastName: referrer.lastName,
            code: codeRecord.code,
            codeId: codeRecord.id,
            expiresAt: codeRecord.expiresAt ?? undefined,
            discountPercentage: codeRecord.discountSnapshot ?? settings.discountPercentage,
            cashbackAmount: codeRecord.cashbackSnapshot ?? settings.cashbackAmount,
            shopUrl,
          });
          welcomeEmailSent = true;
        } catch (emailError) {
          console.error("❌ Impossible d'envoyer l'email de bienvenue parrain:", emailError);
          welcomeEmailError =
            emailError instanceof Error
              ? emailError.message
              : "Erreur inconnue lors de l'envoi de l'email.";
        }
      } else {
        welcomeEmailError = "Email du parrain manquant, impossible d'envoyer le message de bienvenue.";
      }
    }

    const message =
      existingCodesBefore > 0
        ? "Parrain déjà existant, code mis à jour."
        : existingReferrerBefore
          ? "Parrain existant, code généré."
          : "Parrain créé et code généré.";

    return json<ActionData>({
      success: true,
      message,
      referrerId: referrer.id,
      code: codeRecord?.code ?? "—",
      customerCreated: created,
      referrerCreated: !existingReferrerBefore,
      existingCodesBefore,
      discountCreated,
      discountError,
      customerShopifyId: customer.id,
      welcomeEmailSent,
      welcomeEmailError,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Impossible d'ajouter le parrain pour le moment. Réessaie plus tard.";
    console.error("❌ Impossible d'ajouter le parrain manuellement:", message);
    return json<ActionData>({ error: message }, { status: 400 });
  }
};

export default function AddReferrerPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      setFirstName("");
      setLastName("");
      setEmail("");
    }
  }, [actionData]);

  return (
    <Page
      title="Ajouter un parrain manuellement"
      primaryAction={{
        content: "Importer depuis CSV",
        url: "/app/import-referrers",
      }}
    >
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical">{actionData.error}</Banner>
        ) : null}

        {actionData && "success" in actionData && actionData.success ? (
          <Banner tone="success">
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                {actionData.message}
              </Text>
              <Text as="p" variant="bodySm">
                Client Shopify&nbsp;:{" "}
                <strong>{actionData.customerCreated ? "créé" : "déjà existant"}</strong>
              </Text>
              <Text as="p" variant="bodySm">
                Parrain&nbsp;:{" "}
                <strong>{actionData.referrerCreated ? "nouveau" : "déjà existant"}</strong>
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Codes avant import&nbsp;: {actionData.existingCodesBefore}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Code associé&nbsp;: <strong>{actionData.code}</strong>
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Client Shopify ID&nbsp;: {actionData.customerShopifyId}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Lien parrain&nbsp;:{" "}
                <Link to={`/app/parrain/${actionData.referrerId}`} prefetch="intent">
                  ouvrir la fiche
                </Link>
              </Text>
              {actionData.welcomeEmailSent ? (
                <Text as="p" variant="bodySm" tone="success">
                  Email de bienvenue envoyé au parrain.
                </Text>
              ) : actionData.welcomeEmailError ? (
                <Banner tone="warning">
                  Impossible d'envoyer l'email de bienvenue&nbsp;: {actionData.welcomeEmailError}
                </Banner>
              ) : null}
              {actionData.existingCodesBefore > 0 ? (
                <Banner tone="info">
                  Ce parrain possédait déjà un code ({actionData.code}). Aucun nouveau code ni discount n&apos;a été créé.
                </Banner>
              ) : null}
            </BlockStack>
          </Banner>
        ) : null}

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <TextField
                label="Prénom"
                name="firstName"
                autoComplete="given-name"
                value={firstName}
                onChange={setFirstName}
              />
              <TextField
                label="Nom"
                name="lastName"
                autoComplete="family-name"
                value={lastName}
                onChange={setLastName}
              />
              <TextField
                label="Email"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                requiredIndicator
              />
              <InlineStack align="end">
                <Button
                  submit
                  variant="primary"
                  loading={isSubmitting}
                  disabled={!email.trim()}
                >
                  Ajouter le parrain
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}

