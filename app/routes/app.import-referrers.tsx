import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Button,
  Banner,
  InlineStack,
  Text,
  DataTable,
  ProgressBar,
  Checkbox,
} from "@shopify/polaris";
import { useState, useEffect, useCallback, useRef } from "react";

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
  acceptsMarketing: boolean;
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

type ParseActionData =
  | {
      action: "parse";
      success: true;
      rows: ImportRow[];
    }
  | { action: "parse"; success?: false; error: string };

type ProcessActionData =
  | {
      action: "process";
      success: true;
      result: ImportResult;
    }
  | { action: "process"; success?: false; error: string };

type ActionData = ParseActionData | ProcessActionData;

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
  const acceptsMarketingIndex = headers.findIndex((h) => h === "accept_marketing" || h === "acceptmarketing" || h === "accept marketing");

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

    // Parser acceptsMarketing : true par défaut si colonne absente, sinon parser la valeur
    let acceptsMarketing = true;
    if (acceptsMarketingIndex >= 0) {
      const value = values[acceptsMarketingIndex]?.trim().toLowerCase();
      acceptsMarketing = value === "true" || value === "1" || value === "yes" || value === "oui" || value === "";
    }

    rows.push({
      email,
      firstName: firstNameIndex >= 0 ? values[firstNameIndex]?.trim() : undefined,
      lastName: lastNameIndex >= 0 ? values[lastNameIndex]?.trim() : undefined,
      acceptsMarketing,
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
          acceptsMarketing: row.acceptsMarketing,
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

      // Créer ou mettre à jour le discount Shopify seulement si nécessaire
      // Si le code existe déjà avec un discount, on essaie de le mettre à jour
      // mais on ne considère pas cela comme une erreur critique si ça échoue
      const needsDiscountUpdate = !codeRecord.shopifyDiscountId || !codeAlreadyExists;
      
      if (needsDiscountUpdate || !codeAlreadyExists) {
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
            // Si le discount existe déjà, ce n'est pas une erreur critique
            if (codeRecord.shopifyDiscountId) {
              discountCreated = true; // On considère que c'est OK
            } else {
              errors.push(codeAlreadyExists ? "Impossible de mettre à jour le discount Shopify." : "Impossible de créer le discount Shopify.");
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erreur lors de la création/mise à jour du discount Shopify.";
          // Si le code existe déjà, on ne considère pas cela comme une erreur bloquante
          if (!(codeAlreadyExists && codeRecord.shopifyDiscountId)) {
            errors.push(message);
          }
        }
      } else {
        // Le code et le discount existent déjà, on skip la mise à jour
        if (codeRecord.shopifyDiscountId) {
          discountCreated = true; // On considère que le discount existe
        }
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
            codeId: codeRecord.id,
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
      } else if (!referrer.email) {
        errors.push("Email du parrain manquant, impossible d'envoyer le message de bienvenue.");
      }
    }

    // Si le parrain et le code existent déjà, on ne considère pas cela comme une erreur
    // mais plutôt comme un cas normal (parrain déjà dans le système)
    // IMPORTANT: On utilise referrerCreated pour déterminer si c'est un nouveau parrain
    // car existingReferrerBefore peut être null même si le parrain vient d'être créé dans un traitement précédent
    const isExistingReferrer = !existingReferrerBefore && !referrerCreated ? false : !!(existingReferrerBefore && codeAlreadyExists);
    const success: boolean = errors.length === 0 || isExistingReferrer;
    
    const message = errors.length === 0
      ? !referrerCreated && existingReferrerBefore
        ? codeAlreadyExists
          ? "Parrain déjà existant, code et discount mis à jour."
          : "Parrain existant, code généré."
        : referrerCreated
          ? codeCreated
            ? "Parrain créé et code généré."
            : "Parrain créé, code existant mis à jour."
          : codeCreated
            ? "Code créé pour le parrain."
            : "Code mis à jour."
      : isExistingReferrer
        ? "Parrain déjà existant dans le système."
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
  // Lire le formData une seule fois avant l'authentification
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string | null;
  
  let session;
  try {
    const authResult = await authenticate.admin(request);
    session = authResult.session;
  } catch (authError) {
    if (actionType === "process") {
      return json<ProcessActionData>(
        { action: "process", error: "Erreur d'authentification. Veuillez vous reconnecter." },
        { status: 401 }
      );
    }
    return json<ParseActionData>(
      { action: "parse", error: "Erreur d'authentification. Veuillez vous reconnecter." },
      { status: 401 }
    );
  }
  
  // Action: Parser le CSV
  if (actionType === "parse") {
    const file = formData.get("csvFile") as File | null;

    if (!file) {
      return json<ParseActionData>({ action: "parse", error: "Aucun fichier CSV fourni." }, { status: 400 });
    }

    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      return json<ParseActionData>({ action: "parse", error: "Le fichier doit être un fichier CSV." }, { status: 400 });
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
        return json<ParseActionData>({ action: "parse", error: message }, { status: 400 });
      }

      if (rows.length === 0) {
        return json<ParseActionData>({ action: "parse", error: "Le fichier CSV ne contient aucune ligne de données valide." }, { status: 400 });
      }

      return json<ParseActionData>({
        action: "parse",
        success: true,
        rows,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inattendue lors du parsing du CSV.";
      console.error("❌ Erreur lors du parsing CSV:", error);
      return json<ParseActionData>({ action: "parse", error: message }, { status: 500 });
    }
  }

  // Action: Traiter un seul parrain
  if (actionType === "process") {
    const email = formData.get("email") as string | null;
    const firstName = formData.get("firstName") as string | null;
    const lastName = formData.get("lastName") as string | null;
    const rowNumber = formData.get("rowNumber") as string | null;
    const acceptsMarketingRaw = formData.get("acceptsMarketing") as string | null;

    if (!email) {
      return json<ProcessActionData>({ action: "process", error: "L'email est obligatoire." }, { status: 400 });
    }

    try {
      const settings = await getReferralSettings();

      const acceptsMarketing = acceptsMarketingRaw === "true" || acceptsMarketingRaw === null;

      const row: ImportRow = {
        email: email.trim().toLowerCase(),
        firstName: firstName?.trim() || undefined,
        lastName: lastName?.trim() || undefined,
        acceptsMarketing,
        rowNumber: rowNumber ? parseInt(rowNumber, 10) : 0,
      };

      const result = await processReferrerRow(row, session, settings);
      
      // Log concis pour la création des parrains
      if (result.success) {
        if (result.referrerCreated) {
          console.log(`✅ Parrain créé: ${row.email}`);
        } else if (result.codeCreated) {
          console.log(`✅ Code créé pour: ${row.email}`);
        }
      }

      return json<ProcessActionData>({
        action: "process",
        success: true,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inattendue lors du traitement.";
      console.error(`❌ Erreur lors du traitement du parrain ${email}:`, error);
      if (error instanceof Error && error.stack) {
        console.error("Stack trace:", error.stack);
      }
      return json<ProcessActionData>({ action: "process", error: message }, { status: 500 });
    }
  }

  return json<ActionData>({ action: "parse", error: "Action non reconnue." }, { status: 400 });
};

export default function ImportReferrersPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const parseFetcher = useFetcher<ActionData>();

  const [fileSelected, setFileSelected] = useState(false);
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [results, setResults] = useState<Map<number, ImportResult>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentRowNumber, setCurrentRowNumber] = useState<number | null>(null);
  
  // Gérer les checkboxes d'acceptation newsletter (modifiables avant traitement)
  const updateAcceptsMarketing = useCallback((rowNumber: number, value: boolean) => {
    setParsedRows((prev) => 
      prev.map((row) => 
        row.rowNumber === rowNumber ? { ...row, acceptsMarketing: value } : row
      )
    );
  }, []);

  const isSubmitting = navigation.state === "submitting" || parseFetcher.state !== "idle";

  // Gérer la réponse du parsing
  useEffect(() => {
    if (parseFetcher.data && "action" in parseFetcher.data && parseFetcher.data.action === "parse") {
      if ("success" in parseFetcher.data && parseFetcher.data.success && "rows" in parseFetcher.data) {
        setParsedRows(parseFetcher.data.rows);
        setResults(new Map());
        setCurrentRowNumber(null);
        setIsProcessing(false);
      }
    }
  }, [parseFetcher.data]);

  const processFetcher = useFetcher<ProcessActionData>();
  const [pendingRowIndex, setPendingRowIndex] = useState<number | null>(null);
  const processedRowIndexRef = useRef<number | null>(null);
  const submittedRowsRef = useRef<Set<number>>(new Set()); // Protection contre les doubles soumissions
  const processedRowsRef = useRef<Set<number>>(new Set()); // Protection contre le retraitement de la même réponse

  // Gérer les réponses et déclencher le traitement suivant
  useEffect(() => {
    // Si on vient de recevoir une réponse, la traiter
    if (processFetcher.state === "idle" && processFetcher.data && processedRowIndexRef.current !== null) {
      const rowIndex = processedRowIndexRef.current;
      const row = parsedRows[rowIndex];
      const data = processFetcher.data;
      
      // Protection : éviter de traiter la même réponse plusieurs fois
      if (processedRowsRef.current.has(row.rowNumber)) {
        // Réinitialiser quand même pour permettre le suivant
        processedRowIndexRef.current = null;
        // Passer au suivant immédiatement
        if (rowIndex < parsedRows.length - 1) {
          setTimeout(() => {
            setPendingRowIndex(rowIndex + 1);
          }, 100);
        } else {
          setIsProcessing(false);
          setCurrentRowNumber(null);
          setPendingRowIndex(null);
          submittedRowsRef.current.clear();
          processedRowsRef.current.clear();
        }
        return;
      }
      
      processedRowsRef.current.add(row.rowNumber);
      
      // Retirer de la liste des soumissions en cours
      submittedRowsRef.current.delete(row.rowNumber);
      
      if (data.action === "process" && "success" in data && data.success && "result" in data) {
        setResults((prev) => {
          // Double vérification : éviter d'écraser un résultat existant
          if (prev.has(row.rowNumber)) {
            return prev;
          }
          const newMap = new Map(prev);
          newMap.set(row.rowNumber, data.result);
          return newMap;
        });
      } else {
        // En cas d'erreur, créer un résultat d'erreur
        const errorResult: ImportResult = {
          email: row.email,
          success: false,
          message: "error" in data ? data.error : "Erreur inconnue",
          errors: ["error" in data ? data.error : "Erreur inconnue"],
          customerCreated: false,
          referrerCreated: false,
          codeCreated: false,
          discountCreated: false,
          emailSent: false,
        };
        setResults((prev) => {
          // Double vérification : éviter d'écraser un résultat existant
          if (prev.has(row.rowNumber)) {
            return prev;
          }
          const newMap = new Map(prev);
          newMap.set(row.rowNumber, errorResult);
          return newMap;
        });
      }
      
      // Réinitialiser la référence pour permettre le traitement suivant
      processedRowIndexRef.current = null;
      
      // Traiter le suivant après un délai
      if (rowIndex < parsedRows.length - 1) {
        setTimeout(() => {
          setPendingRowIndex(rowIndex + 1);
        }, 1000);
      } else {
        // Tous les parrains ont été traités
        setIsProcessing(false);
        setCurrentRowNumber(null);
        setPendingRowIndex(null);
        submittedRowsRef.current.clear();
        processedRowsRef.current.clear();
      }
    }
    
    // Si on a un index à traiter et que le fetcher est inactif, soumettre la requête
    if (pendingRowIndex !== null && processFetcher.state === "idle" && pendingRowIndex < parsedRows.length && processedRowIndexRef.current === null) {
      const row = parsedRows[pendingRowIndex];
      
      // Protection : ne pas soumettre si cette ligne a déjà été soumise OU déjà traitée
      if (submittedRowsRef.current.has(row.rowNumber) || processedRowsRef.current.has(row.rowNumber)) {
        console.log(`⏭️ Ligne ${row.rowNumber} (${row.email}) déjà traitée, passage au suivant`);
        // Si déjà soumise ou traitée, passer au suivant
        if (pendingRowIndex < parsedRows.length - 1) {
          setTimeout(() => {
            setPendingRowIndex(pendingRowIndex + 1);
          }, 100);
        } else {
          // C'est le dernier, terminer
          setIsProcessing(false);
          setCurrentRowNumber(null);
          setPendingRowIndex(null);
          submittedRowsRef.current.clear();
          processedRowsRef.current.clear();
        }
        return;
      }
      
      console.log(`📤 Soumission ligne ${row.rowNumber} (${row.email})`);
      setCurrentRowNumber(row.rowNumber);
      processedRowIndexRef.current = pendingRowIndex; // Marquer comme en cours de traitement
      submittedRowsRef.current.add(row.rowNumber); // Marquer comme soumise
      
      const formData = new FormData();
      formData.append("actionType", "process");
      formData.append("email", row.email);
      if (row.firstName) formData.append("firstName", row.firstName);
      if (row.lastName) formData.append("lastName", row.lastName);
      formData.append("acceptsMarketing", row.acceptsMarketing ? "true" : "false");
      formData.append("rowNumber", row.rowNumber.toString());
      
      processFetcher.submit(formData, {
        method: "POST",
        action: "/app/import-referrers",
      });
    }
  }, [processFetcher.state, processFetcher.data, pendingRowIndex, parsedRows]);

  // Traiter les parrains séquentiellement
  const startProcessing = useCallback(() => {
    if (parsedRows.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setCurrentRowNumber(null);
    setResults(new Map());
    processedRowIndexRef.current = null;
    submittedRowsRef.current.clear(); // Réinitialiser les soumissions
    processedRowsRef.current.clear(); // Réinitialiser les réponses traitées
    setPendingRowIndex(0); // Commencer par le premier
  }, [parsedRows, isProcessing]);

  // Calculer les statistiques
  const processedCount = results.size;
  const successfulCount = Array.from(results.values()).filter((r) => r.success).length;
  const failedCount = processedCount - successfulCount;
  const progress = parsedRows.length > 0 ? (processedCount / parsedRows.length) * 100 : 0;

  // Préparer les lignes du tableau
  const tableRows = parsedRows.map((row) => {
    const result = results.get(row.rowNumber);
    if (!result) {
      const isCurrent = isProcessing && currentRowNumber === row.rowNumber;
      return [
        row.email,
        isCurrent ? "⏳" : "⏸️",
        isCurrent ? "Traitement en cours..." : "En attente",
        row.acceptsMarketing ? "Oui" : "Non",
        "—",
        "—",
        "—",
        "—",
        "—",
        "—",
      ];
    }
    return [
      result.email,
      result.success ? "✅" : "❌",
      result.message,
      row.acceptsMarketing ? "Oui" : "Non",
      result.code || "—",
      result.customerCreated ? "Oui" : "Non",
      result.referrerCreated ? "Oui" : "Non",
      result.codeCreated ? "Oui" : "Non",
      result.discountCreated ? "Oui" : "Non",
      result.emailSent ? "Oui" : "Non",
    ];
  });

  const hasParseError = 
    (actionData && "error" in actionData && actionData.error) ||
    (parseFetcher.data && "action" in parseFetcher.data && parseFetcher.data.action === "parse" && "error" in parseFetcher.data);
  
  const parseError = 
    (actionData && "error" in actionData ? actionData.error : null) ||
    (parseFetcher.data && "action" in parseFetcher.data && parseFetcher.data.action === "parse" && "error" in parseFetcher.data ? parseFetcher.data.error : null);

  const isComplete = parsedRows.length > 0 && processedCount === parsedRows.length && !isProcessing;

  return (
    <Page
      title="Importer des parrains depuis un CSV"
      backAction={{ content: "Ajouter un parrain", url: "/app/add-referrer" }}
    >
      <BlockStack gap="400">
        {hasParseError && parseError ? (
          <Banner tone="critical">{parseError}</Banner>
        ) : null}

        {parsedRows.length > 0 && (
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Liste des parrains à créer ({parsedRows.length})
                  </Text>
                  {isProcessing && (
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm">
                        Traitement en cours... {processedCount}/{parsedRows.length}
                      </Text>
                      <ProgressBar progress={progress} />
                    </BlockStack>
                  )}
                  {isComplete && (
                    <Banner tone={failedCount === 0 ? "success" : "warning"}>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          Traitement terminé
                        </Text>
                        <Text as="p" variant="bodySm">
                          Total: {parsedRows.length} | Réussis: {successfulCount} | Échecs: {failedCount}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Clients créés: {Array.from(results.values()).filter((r) => r.customerCreated).length} | 
                          Parrains créés: {Array.from(results.values()).filter((r) => r.referrerCreated).length} | 
                          Codes créés: {Array.from(results.values()).filter((r) => r.codeCreated).length} | 
                          Discounts créés: {Array.from(results.values()).filter((r) => r.discountCreated).length} | 
                          Emails envoyés: {Array.from(results.values()).filter((r) => r.emailSent).length}
                        </Text>
                      </BlockStack>
                    </Banner>
                  )}
                </BlockStack>

                {tableRows.length > 0 && (
                  <BlockStack gap="300">
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text", "text", "text"]}
                      headings={["Email", "Statut", "Message", "Newsletter", "Code", "Client créé", "Parrain créé", "Code créé", "Discount créé", "Email envoyé"]}
                      rows={tableRows}
                    />
                    {!isProcessing && parsedRows.length > 0 && processedCount === 0 && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          Ajuster l'acceptation de la newsletter (modifiable avant le traitement) :
                        </Text>
                        <BlockStack gap="200">
                          {parsedRows.map((row) => (
                            <Checkbox
                              key={row.rowNumber}
                              label={`${row.email}${row.firstName || row.lastName ? ` (${[row.firstName, row.lastName].filter(Boolean).join(" ")})` : ""}`}
                              checked={row.acceptsMarketing}
                              onChange={(value) => updateAcceptsMarketing(row.rowNumber, value)}
                              disabled={isProcessing}
                            />
                          ))}
                        </BlockStack>
                      </BlockStack>
                    )}
                  </BlockStack>
                )}

                {!isProcessing && parsedRows.length > 0 && processedCount === 0 && (
                  <InlineStack align="end">
                    <Button
                      onClick={startProcessing}
                      variant="primary"
                    >
                      Commencer la génération des parrains
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Importez un fichier CSV contenant les informations des parrains à ajouter.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Le fichier CSV doit contenir au minimum une colonne <strong>email</strong>. Les colonnes optionnelles sont <strong>prenom</strong> (ou firstname), <strong>nom</strong> (ou lastname) et <strong>accept_marketing</strong> (true/false, par défaut true si absent).
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Exemple de format CSV:
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <code>
                email,prenom,nom,accept_marketing<br />
                john@example.com,John,Doe,true<br />
                jane@example.com,Jane,Smith,false
              </code>
            </Text>

            <parseFetcher.Form method="post" encType="multipart/form-data">
              <BlockStack gap="300">
                <input
                  type="file"
                  name="csvFile"
                  accept=".csv,text/csv"
                  onChange={(e) => setFileSelected(!!e.target.files?.[0])}
                  required
                />
                <input type="hidden" name="actionType" value="parse" />
                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    disabled={!fileSelected || isSubmitting || isProcessing}
                  >
                    {isSubmitting ? "Parsing du CSV..." : "Importer le CSV"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </parseFetcher.Form>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

