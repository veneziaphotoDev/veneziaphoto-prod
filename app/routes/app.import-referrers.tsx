import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Button,
  Banner,
  InlineStack,
  Text,
  DataTable,
} from "@shopify/polaris";
import { useState } from "react";

import { authenticate } from "app/shopify.server";
import { getOrCreateCustomerByEmail } from "app/services/customers.server";
import { getOrCreateReferrerFromCustomer } from "app/services/referrers.server";
import { getReferralSettings } from "app/services/settings.server";
import { createCodeForReferrer, linkShopifyDiscountId } from "app/services/codes.server";
import { recreateShopifyDiscount } from "app/services/discounts.server";
import prisma from "app/db.server";
import { sendManualReferrerWelcomeEmail } from "app/services/email.server";

type ImportRow = {
  email: string;
  firstName?: string;
  lastName?: string;
  rowNumber: number;
};

type ImportResult = {
  email: string;
  success: boolean;
  message: string;
  referrerId?: string;
  code?: string;
  customerCreated: boolean;
  referrerCreated: boolean;
  codeCreated: boolean;
  discountCreated: boolean;
  emailSent: boolean;
  errors: string[];
};

type ActionData =
  | {
      success: true;
      results: ImportResult[];
      summary: {
        total: number;
        successful: number;
        failed: number;
        customersCreated: number;
        referrersCreated: number;
        codesCreated: number;
        discountsCreated: number;
        emailsSent: number;
      };
    }
  | { success?: false; error: string };

function parseCSV(csvText: string): ImportRow[] {
  const lines = csvText.trim().split("\n");
  if (lines.length === 0) {
    throw new Error("Le fichier CSV est vide.");
  }

  // Détecter le séparateur (virgule ou point-virgule)
  const firstLine = lines[0];
  const separator = firstLine.includes(";") ? ";" : ",";

  // Parser l'en-tête
  const headers = firstLine.split(separator).map((h) => h.trim().toLowerCase());
  const emailIndex = headers.findIndex((h) => h === "email" || h === "e-mail");
  const firstNameIndex = headers.findIndex((h) => h === "prenom" || h === "prénom" || h === "firstname" || h === "first_name");
  const lastNameIndex = headers.findIndex((h) => h === "nom" || h === "lastname" || h === "last_name");

  if (emailIndex === -1) {
    throw new Error("Le fichier CSV doit contenir une colonne 'email'.");
  }

  const rows: ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(separator).map((v) => v.trim().replace(/^"|"$/g, ""));
    const email = values[emailIndex]?.trim().toLowerCase();

    if (!email) {
      continue; // Ignorer les lignes sans email
    }

    rows.push({
      email,
      firstName: firstNameIndex >= 0 ? values[firstNameIndex]?.trim() : undefined,
      lastName: lastNameIndex >= 0 ? values[lastNameIndex]?.trim() : undefined,
      rowNumber: i + 1,
    });
  }

  return rows;
}

function validateEmail(value: string | null): string | null {
  if (!value) return "L'email est obligatoire.";
  const email = value.trim().toLowerCase();
  if (!email) return "L'email est obligatoire.";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return "Format d'email invalide.";
  return null;
}

function computeExpiryDate(codeValidityDays: number): Date | null {
  if (!codeValidityDays || codeValidityDays <= 0) {
    return null;
  }
  const expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + codeValidityDays);
  return expiry;
}

async function processReferrerRow(
  row: ImportRow,
  session: { shop?: string | null },
  settings: Awaited<ReturnType<typeof getReferralSettings>>,
): Promise<ImportResult> {
  const errors: string[] = [];
  let referrerId: string | undefined;
  let code: string | undefined;
  let customerCreated = false;
  let referrerCreated = false;
  let codeCreated = false;
  let discountCreated = false;
  let emailSent = false;

  try {
    // Validation de l'email
    const emailError = validateEmail(row.email);
    if (emailError) {
      errors.push(emailError);
      return {
        email: row.email,
        success: false,
        message: emailError,
        customerCreated,
        referrerCreated,
        codeCreated,
        discountCreated,
        emailSent,
        errors,
      };
    }

    // Créer ou récupérer le client Shopify
    let customer;
    try {
      const customerResult = await getOrCreateCustomerByEmail(
        {
          email: row.email,
          firstName: row.firstName || null,
          lastName: row.lastName || null,
        },
        session?.shop,
      );
      customer = customerResult.customer;
      customerCreated = customerResult.created;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur lors de la création/récupération du client Shopify.";
      errors.push(message);
      return {
        email: row.email,
        success: false,
        message,
        customerCreated,
        referrerCreated,
        codeCreated,
        discountCreated,
        emailSent,
        errors,
      };
    }

    // Vérifier si le parrain existe déjà
    const existingReferrerBefore = await prisma.referrer.findUnique({
      where: { shopifyCustomerId: customer.id },
    });

    // Créer ou récupérer le parrain
    const referrer = await getOrCreateReferrerFromCustomer({
      id: customer.id,
      email: customer.email,
      first_name: row.firstName || customer.firstName || null,
      last_name: row.lastName || customer.lastName || null,
    });

    referrerId = referrer.id;
    referrerCreated = !existingReferrerBefore;

    // Vérifier les codes existants
    const existingCodesBefore = await prisma.code.count({
      where: { referrerId: referrer.id },
    });

    let codeRecord = null;
    let codeAlreadyExists = false;

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

    // Créer un nouveau code si nécessaire
    if (!codeRecord) {
      try {
        codeRecord = await createCodeForReferrer({
          referrerId: referrer.id,
          settings,
          sendEmail: false, // On enverra l'email manuellement après
        });
        codeCreated = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur lors de la création du code.";
        errors.push(message);
      }
    } else {
      // Mettre à jour le code existant
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
      errors.push("Impossible de récupérer ou créer un code de parrainage.");
    } else {
      code = codeRecord.code;

      // Créer ou mettre à jour le discount Shopify
      try {
        const discount = await recreateShopifyDiscount({
          code: codeRecord,
          settings,
          shopDomain: session?.shop,
        });

        if (discount) {
          await linkShopifyDiscountId(codeRecord.id, discount.discountId);
          discountCreated = true;
        } else {
          errors.push(codeAlreadyExists ? "Impossible de mettre à jour le discount Shopify." : "Impossible de créer le discount Shopify.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur lors de la création/mise à jour du discount Shopify.";
        errors.push(message);
      }

      // Envoyer l'email de bienvenue
      const shopUrl = session?.shop ? `https://${session.shop}` : undefined;
      const shouldSendWelcome = codeRecord.code && (!codeAlreadyExists || !existingReferrerBefore);

      if (shouldSendWelcome && referrer.email) {
        try {
          await sendManualReferrerWelcomeEmail({
            referrerId: referrer.id,
            referrerEmail: referrer.email,
            firstName: referrer.firstName,
            lastName: referrer.lastName,
            code: codeRecord.code,
            expiresAt: codeRecord.expiresAt ?? undefined,
            discountPercentage: codeRecord.discountSnapshot ?? settings.discountPercentage,
            cashbackAmount: codeRecord.cashbackSnapshot ?? settings.cashbackAmount,
            shopUrl,
          });
          emailSent = true;
        } catch (emailError) {
          const message = emailError instanceof Error ? emailError.message : "Erreur inconnue lors de l'envoi de l'email.";
          errors.push(`Email non envoyé: ${message}`);
        }
      } else if (shouldSendWelcome && !referrer.email) {
        errors.push("Email du parrain manquant, impossible d'envoyer le message de bienvenue.");
      }
    }

    const success = errors.length === 0;
    const message = success
      ? codeAlreadyExists
        ? "Parrain déjà existant, code mis à jour."
        : existingReferrerBefore
          ? "Parrain existant, code généré."
          : "Parrain créé et code généré."
      : errors.join(" | ");

    return {
      email: row.email,
      success,
      message,
      referrerId,
      code,
      customerCreated,
      referrerCreated,
      codeCreated,
      discountCreated,
      emailSent,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inattendue lors du traitement.";
    errors.push(message);
    return {
      email: row.email,
      success: false,
      message,
      referrerId,
      code,
      customerCreated,
      referrerCreated,
      codeCreated,
      discountCreated,
      emailSent,
      errors,
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const file = formData.get("csvFile") as File | null;

  if (!file) {
    return json<ActionData>({ error: "Aucun fichier CSV fourni." }, { status: 400 });
  }

  if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
    return json<ActionData>({ error: "Le fichier doit être un fichier CSV." }, { status: 400 });
  }

  try {
    // Lire le contenu du fichier
    const csvText = await file.text();

    // Parser le CSV
    let rows: ImportRow[];
    try {
      rows = parseCSV(csvText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur lors du parsing du CSV.";
      return json<ActionData>({ error: message }, { status: 400 });
    }

    if (rows.length === 0) {
      return json<ActionData>({ error: "Le fichier CSV ne contient aucune ligne de données valide." }, { status: 400 });
    }

    // Récupérer les paramètres
    const settings = await getReferralSettings();

    // Traiter chaque ligne
    const results: ImportResult[] = [];
    for (const row of rows) {
      const result = await processReferrerRow(row, session, settings);
      results.push(result);
    }

    // Calculer le résumé
    const summary = {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      customersCreated: results.filter((r) => r.customerCreated).length,
      referrersCreated: results.filter((r) => r.referrerCreated).length,
      codesCreated: results.filter((r) => r.codeCreated).length,
      discountsCreated: results.filter((r) => r.discountCreated).length,
      emailsSent: results.filter((r) => r.emailSent).length,
    };

    return json<ActionData>({
      success: true,
      results,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inattendue lors de l'import.";
    console.error("❌ Erreur lors de l'import CSV:", error);
    return json<ActionData>({ error: message }, { status: 500 });
  }
};

export default function ImportReferrersPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [fileSelected, setFileSelected] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  const tableRows = actionData && "results" in actionData
    ? actionData.results.map((result) => [
        result.email,
        result.success ? "✅" : "❌",
        result.message,
        result.code || "—",
        result.customerCreated ? "Oui" : "Non",
        result.referrerCreated ? "Oui" : "Non",
        result.codeCreated ? "Oui" : "Non",
        result.discountCreated ? "Oui" : "Non",
        result.emailSent ? "Oui" : "Non",
      ])
    : [];

  return (
    <Page
      title="Importer des parrains depuis un CSV"
      backAction={{ content: "Ajouter un parrain", url: "/app/add-referrer" }}
    >
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical">{actionData.error}</Banner>
        ) : null}

        {actionData && "success" in actionData && actionData.success ? (
          <BlockStack gap="400">
            <Banner tone="success">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Import terminé
                </Text>
                <Text as="p" variant="bodySm">
                  Total: {actionData.summary.total} | Réussis: {actionData.summary.successful} | Échecs: {actionData.summary.failed}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Clients créés: {actionData.summary.customersCreated} | Parrains créés: {actionData.summary.referrersCreated} | Codes créés: {actionData.summary.codesCreated} | Discounts créés: {actionData.summary.discountsCreated} | Emails envoyés: {actionData.summary.emailsSent}
                </Text>
              </BlockStack>
            </Banner>

            {actionData.summary.failed > 0 && (
              <Banner tone="warning">
                {actionData.summary.failed} ligne(s) ont échoué. Vérifiez les détails ci-dessous.
              </Banner>
            )}

            {tableRows.length > 0 && (
              <Card>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text", "text"]}
                  headings={["Email", "Statut", "Message", "Code", "Client créé", "Parrain créé", "Code créé", "Discount créé", "Email envoyé"]}
                  rows={tableRows}
                />
              </Card>
            )}
          </BlockStack>
        ) : null}

        <Card>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Importez un fichier CSV contenant les informations des parrains à ajouter.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Le fichier CSV doit contenir au minimum une colonne <strong>email</strong>. Les colonnes optionnelles sont <strong>prenom</strong> (ou firstname) et <strong>nom</strong> (ou lastname).
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Exemple de format CSV:
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <code>
                email,prenom,nom<br />
                john@example.com,John,Doe<br />
                jane@example.com,Jane,Smith
              </code>
            </Text>

            <Form method="post" encType="multipart/form-data">
              <BlockStack gap="300">
                <input
                  type="file"
                  name="csvFile"
                  accept=".csv,text/csv"
                  onChange={(e) => setFileSelected(!!e.target.files?.[0])}
                  required
                />
                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    disabled={!fileSelected || isSubmitting}
                  >
                    {isSubmitting ? "Import en cours..." : "Importer le CSV"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

