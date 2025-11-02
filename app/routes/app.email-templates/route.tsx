import { useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import {
    Page,
    Card,
    Button,
    Banner,
    Tabs,
    Text,
    TextField,
    BlockStack,
    InlineStack,
    ButtonGroup,
} from "@shopify/polaris";
import { useState, useEffect, useMemo } from "react";
import { EmailTemplateType } from "app/models/email";
import type { loader as Loader, action as Action } from "./route.server";

export { loader, action } from "./route.server";

type PreviewMode = "html" | "text";

function replaceVars(template: string, vars: Record<string, string>) {
    return Object.entries(vars).reduce(
        (compiled, [key, value]) => compiled.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value ?? ""),
        template || "",
    );
}

function sanitizePreviewVars(vars: Record<string, string>) {
    return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, value ?? ""]));
}

type EmailPreviewProps = {
    subject: string;
    html: string;
    text?: string;
    sampleVars: Record<string, string>;
    mode: PreviewMode;
    onModeChange: (mode: PreviewMode) => void;
    type: EmailTemplateType;
};

function EmailPreview({ subject, html, text, sampleVars, mode, onModeChange, type }: EmailPreviewProps) {
    const sanitizedVars = useMemo(() => sanitizePreviewVars(sampleVars), [sampleVars]);

    const previewSubject = useMemo(() => replaceVars(subject, sanitizedVars), [subject, sanitizedVars]);
    const previewHtml = useMemo(() => replaceVars(html, sanitizedVars), [html, sanitizedVars]);
    const previewText = useMemo(() => replaceVars(text ?? "", sanitizedVars), [text, sanitizedVars]);

    const hasTextVersion = Boolean((text ?? "").trim());
    const showTextMode = hasTextVersion && mode === "text";

    const previewDocument = useMemo(() => {
        const trimmed = previewHtml.trim();

        if (!trimmed) {
            return "<!doctype html><html><head><meta charset='utf-8'></head><body><p>—</p></body></html>";
        }

        if (/<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
            return trimmed;
        }

        return `<!doctype html><html><head><meta charset='utf-8'></head><body>${trimmed}</body></html>`;
    }, [previewHtml]);

    return (
        <Card>
            <BlockStack gap="300">
                <InlineStack align="space-between" gap="300">
                    <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                            Sujet
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {previewSubject || "—"}
                        </Text>
                    </BlockStack>
                    {hasTextVersion && (
                        <ButtonGroup>
                            <Button size="slim" pressed={!showTextMode} onClick={() => onModeChange("html")}>
                                HTML
                            </Button>
                            <Button size="slim" pressed={showTextMode} onClick={() => onModeChange("text")}>
                                Texte
                            </Button>
                        </ButtonGroup>
                    )}
                </InlineStack>
                {showTextMode ? (
                    <pre
                        style={{
                            backgroundColor: "#F6F7F8",
                            borderRadius: 8,
                            padding: 16,
                            fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            whiteSpace: "pre-wrap",
                            margin: 0,
                        }}
                    >
                        {previewText || "—"}
                    </pre>
                ) : (
                    <iframe
                        title={`email-preview-${type}`}
                        srcDoc={previewDocument}
                        style={{
                            width: "100%",
                            minHeight: "640px",
                            border: "1px solid #E1E3E5",
                            borderRadius: 8,
                            backgroundColor: "#FFFFFF",
                        }}
                    />
                )}
            </BlockStack>
        </Card>
    );
}

const defaultSamples: Record<EmailTemplateType, Record<string, string>> = {
    [EmailTemplateType.CODE_PROMO]: {
        firstName: "Aline",
        lastName: "Dupont",
        code: "ABC-1234",
        discountPercentage: "10%",
        cashbackAmount: "20 €",
        workshopTitle: "Atelier Portrait",
        workshopQuantity: "1",
        expiresAt: "15 décembre 2025",
        shopUrl: "https://venezia-photo.myshopify.com",
        logoUrl:
            "https://veneziaphoto.myshopify.com/cdn/shop/files/logo--to-replace_b27e332b-e510-4edf-a148-a60c4fcecf48.svg?v=1762347140&width=261",
        logoAlt: "Venezia Photo",
    },
    [EmailTemplateType.CASHBACK_CONFIRMATION]: {
        firstName: "Aline",
        lastName: "Dupont",
        cashbackAmount: "20 €",
        refereeEmail: "marie@example.com",
        logoUrl:
            "https://veneziaphoto.myshopify.com/cdn/shop/files/logo--to-replace_b27e332b-e510-4edf-a148-a60c4fcecf48.svg?v=1762347140&width=261",
        logoAlt: "Venezia Photo",
    },
    [EmailTemplateType.MANUAL_REFERRER_WELCOME]: {
        firstName: "Aline",
        lastName: "Dupont",
        code: "ABC-1234",
        discountPercentage: "10%",
        cashbackAmount: "20 €",
        expiresAt: "15 décembre 2025",
        logoUrl:
            "https://veneziaphoto.myshopify.com/cdn/shop/files/logo--to-replace_b27e332b-e510-4edf-a148-a60c4fcecf48.svg?v=1762347140&width=261",
        logoAlt: "Venezia Photo",
    },
};

const placeholderHints: Record<EmailTemplateType, Array<{ token: string; description: string }>> = {
    [EmailTemplateType.CODE_PROMO]: [
        { token: "{{firstName}}", description: "Prénom du parrain" },
        { token: "{{lastName}}", description: "Nom du parrain" },
        { token: "{{code}}", description: "Code de réduction généré" },
        { token: "{{discountPercentage}}", description: "Remise accordée au filleul" },
        { token: "{{cashbackAmount}}", description: "Montant du cashback" },
        { token: "{{expiresAt}}", description: "Date d'expiration du code" },
        { token: "{{workshopTitle}}", description: "Nom du workshop acheté" },
        { token: "{{workshopQuantity}}", description: "Quantité du workshop" },
        { token: "{{shopUrl}}", description: "Lien vers la boutique Shopify" },
        { token: "{{logoUrl}}", description: "URL absolue du logo à afficher" },
        { token: "{{logoAlt}}", description: "Texte alternatif du logo" },
    ],
    [EmailTemplateType.CASHBACK_CONFIRMATION]: [
        { token: "{{firstName}}", description: "Prénom du parrain" },
        { token: "{{lastName}}", description: "Nom du parrain" },
        { token: "{{cashbackAmount}}", description: "Montant du cashback validé" },
        { token: "{{refereeEmail}}", description: "Email du filleul concerné" },
        { token: "{{logoUrl}}", description: "URL absolue du logo à afficher" },
        { token: "{{logoAlt}}", description: "Texte alternatif du logo" },
    ],
    [EmailTemplateType.MANUAL_REFERRER_WELCOME]: [
        { token: "{{firstName}}", description: "Prénom du parrain" },
        { token: "{{lastName}}", description: "Nom du parrain" },
        { token: "{{code}}", description: "Code de parrainage existant" },
        { token: "{{discountPercentage}}", description: "Remise accordée au filleul" },
        { token: "{{cashbackAmount}}", description: "Montant du cashback" },
        { token: "{{expiresAt}}", description: "Date d'expiration du code" },
        { token: "{{logoUrl}}", description: "URL absolue du logo à afficher" },
        { token: "{{logoAlt}}", description: "Texte alternatif du logo" },
    ],
};

const templateTabs = [
    { id: EmailTemplateType.CODE_PROMO, content: "Email code promo" },
    { id: EmailTemplateType.CASHBACK_CONFIRMATION, content: "Email cashback" },
    { id: EmailTemplateType.MANUAL_REFERRER_WELCOME, content: "Email bienvenue manuel" },
];

const editorTabs = [
    { id: "preview", content: "Prévisualisation" },
    { id: "html-edit", content: "Édition HTML" },
];

function coalesceTemplateValue(value: string | null | undefined, fallback?: string | null) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed ? trimmed : fallback ?? "";
}

export default function EmailTemplatesPage() {
    const data = useLoaderData<typeof Loader>();
    const actionData = useActionData<typeof Action>();
    const navigation = useNavigation();

    const codePromoTemplate = data?.codePromoTemplate ?? { subject: "", bodyHtml: "", bodyText: "" };
    const cashbackConfirmationTemplate =
        data?.cashbackConfirmationTemplate ?? { subject: "", bodyHtml: "", bodyText: "" };
    const manualReferrerTemplate = data?.manualReferrerTemplate ?? { subject: "", bodyHtml: "", bodyText: "" };
    const templateDefaults =
        data?.defaults ?? {
            [EmailTemplateType.CODE_PROMO]: { subject: "", bodyHtml: "", bodyText: "" },
            [EmailTemplateType.CASHBACK_CONFIRMATION]: { subject: "", bodyHtml: "", bodyText: "" },
            [EmailTemplateType.MANUAL_REFERRER_WELCOME]: { subject: "", bodyHtml: "", bodyText: "" },
        };

    const promoDefaults = templateDefaults[EmailTemplateType.CODE_PROMO];
    const cashbackDefaults = templateDefaults[EmailTemplateType.CASHBACK_CONFIRMATION];
    const manualDefaults = templateDefaults[EmailTemplateType.MANUAL_REFERRER_WELCOME];

    const [selectedTemplateTab, setSelectedTemplateTab] = useState(0);

    const [promoSubject, setPromoSubject] = useState(() =>
        coalesceTemplateValue(codePromoTemplate.subject, promoDefaults?.subject),
    );
    const [promoHtml, setPromoHtml] = useState(() =>
        coalesceTemplateValue(codePromoTemplate.bodyHtml, promoDefaults?.bodyHtml),
    );
    const [promoText, setPromoText] = useState(() =>
        coalesceTemplateValue(codePromoTemplate.bodyText, promoDefaults?.bodyText),
    );

    const [cashbackSubject, setCashbackSubject] = useState(
        coalesceTemplateValue(cashbackConfirmationTemplate.subject, cashbackDefaults?.subject),
    );
    const [cashbackHtml, setCashbackHtml] = useState(() =>
        coalesceTemplateValue(cashbackConfirmationTemplate.bodyHtml, cashbackDefaults?.bodyHtml),
    );
    const [cashbackText, setCashbackText] = useState(() =>
        coalesceTemplateValue(cashbackConfirmationTemplate.bodyText, cashbackDefaults?.bodyText),
    );

    const [manualSubject, setManualSubject] = useState(() =>
        coalesceTemplateValue(manualReferrerTemplate.subject, manualDefaults?.subject),
    );
    const [manualHtml, setManualHtml] = useState(() =>
        coalesceTemplateValue(manualReferrerTemplate.bodyHtml, manualDefaults?.bodyHtml),
    );
    const [manualText, setManualText] = useState(() =>
        coalesceTemplateValue(manualReferrerTemplate.bodyText, manualDefaults?.bodyText),
    );

    const [samples, setSamples] = useState<Record<EmailTemplateType, Record<string, string>>>(() => ({
        [EmailTemplateType.CODE_PROMO]: { ...defaultSamples[EmailTemplateType.CODE_PROMO] },
        [EmailTemplateType.CASHBACK_CONFIRMATION]: {
            ...defaultSamples[EmailTemplateType.CASHBACK_CONFIRMATION],
        },
        [EmailTemplateType.MANUAL_REFERRER_WELCOME]: {
            ...defaultSamples[EmailTemplateType.MANUAL_REFERRER_WELCOME],
        },
    }));

    const [previewModes, setPreviewModes] = useState<Record<EmailTemplateType, PreviewMode>>({
        [EmailTemplateType.CODE_PROMO]: "html",
        [EmailTemplateType.CASHBACK_CONFIRMATION]: "html",
        [EmailTemplateType.MANUAL_REFERRER_WELCOME]: "html",
    });

    const [editorTabByTemplate, setEditorTabByTemplate] = useState<Record<EmailTemplateType, number>>({
        [EmailTemplateType.CODE_PROMO]: 0,
        [EmailTemplateType.CASHBACK_CONFIRMATION]: 0,
        [EmailTemplateType.MANUAL_REFERRER_WELCOME]: 0,
    });

    useEffect(() => {
        if (actionData && "success" in actionData && actionData.success && actionData.template) {
            const template = actionData.template;
            const fallback = templateDefaults[template.type as EmailTemplateType];
            const tabIndex = templateTabs.findIndex((tab) => tab.id === template.type);
            if (tabIndex >= 0) {
                setSelectedTemplateTab(tabIndex);
            }

            if (template.type === EmailTemplateType.CODE_PROMO) {
                setPromoSubject(coalesceTemplateValue(template.subject, fallback?.subject));
                setPromoHtml(coalesceTemplateValue(template.bodyHtml, fallback?.bodyHtml));
                setPromoText(coalesceTemplateValue(template.bodyText, fallback?.bodyText));
            } else if (template.type === EmailTemplateType.CASHBACK_CONFIRMATION) {
                setCashbackSubject(coalesceTemplateValue(template.subject, fallback?.subject));
                setCashbackHtml(coalesceTemplateValue(template.bodyHtml, fallback?.bodyHtml));
                setCashbackText(coalesceTemplateValue(template.bodyText, fallback?.bodyText));
            } else if (template.type === EmailTemplateType.MANUAL_REFERRER_WELCOME) {
                setManualSubject(coalesceTemplateValue(template.subject, fallback?.subject));
                setManualHtml(coalesceTemplateValue(template.bodyHtml, fallback?.bodyHtml));
                setManualText(coalesceTemplateValue(template.bodyText, fallback?.bodyText));
            }
        }
    }, [actionData, templateDefaults]);

    const currentTemplate = templateTabs[selectedTemplateTab];
    const currentType = currentTemplate.id as EmailTemplateType;
    const currentSamples = samples[currentType];
    const currentPreviewMode = previewModes[currentType];
    const currentEditorTab = editorTabByTemplate[currentType];

    const templateStates: Record<
        EmailTemplateType,
        {
            subject: string;
            html: string;
            text: string;
            setSubject: (value: string) => void;
            setHtml: (value: string) => void;
            setText: (value: string) => void;
        }
    > = {
        [EmailTemplateType.CODE_PROMO]: {
            subject: promoSubject,
            html: promoHtml,
            text: promoText,
            setSubject: setPromoSubject,
            setHtml: setPromoHtml,
            setText: setPromoText,
        },
        [EmailTemplateType.CASHBACK_CONFIRMATION]: {
            subject: cashbackSubject,
            html: cashbackHtml,
            text: cashbackText,
            setSubject: setCashbackSubject,
            setHtml: setCashbackHtml,
            setText: setCashbackText,
        },
        [EmailTemplateType.MANUAL_REFERRER_WELCOME]: {
            subject: manualSubject,
            html: manualHtml,
            text: manualText,
            setSubject: setManualSubject,
            setHtml: setManualHtml,
            setText: setManualText,
        },
    };

    const currentState = templateStates[currentType];

    const errorMessage = actionData && "error" in actionData ? actionData.error : undefined;
    const successMessage =
        actionData && "success" in actionData && actionData.success ? actionData.message : undefined;

    const navigationState = navigation.state;
    const isSubmitting = navigationState === "submitting";
    const submittingType = isSubmitting ? navigation.formData?.get("templateType") : null;
    const submittingIntent = isSubmitting ? navigation.formData?.get("intent") : null;
    const isSavingCurrent =
        isSubmitting && submittingType === currentType && (submittingIntent === null || submittingIntent === "save");
    const isResettingCurrent = isSubmitting && submittingType === currentType && submittingIntent === "reset";

    const handleSampleChange = (key: string, value: string) => {
        setSamples((prev) => ({
            ...prev,
            [currentType]: {
                ...prev[currentType],
                [key]: value,
            },
        }));
    };

    const resetSamples = () => {
        setSamples((prev) => ({
            ...prev,
            [currentType]: { ...defaultSamples[currentType] },
        }));
    };

    const changePreviewMode = (mode: PreviewMode) => {
        setPreviewModes((prev) => ({
            ...prev,
            [currentType]: mode,
        }));
    };

    const changeEditorTab = (newTabIndex: number) => {
        setEditorTabByTemplate((prev) => ({
            ...prev,
            [currentType]: newTabIndex,
        }));
    };

    const placeholders = placeholderHints[currentType];

    const applyDefaultsToState = (type: EmailTemplateType) => {
        const fallback = templateDefaults[type];
        if (!fallback) return;

        if (type === EmailTemplateType.CODE_PROMO) {
            setPromoSubject(fallback.subject ?? "");
            setPromoHtml(fallback.bodyHtml ?? "");
            setPromoText(fallback.bodyText ?? "");
        } else if (type === EmailTemplateType.CASHBACK_CONFIRMATION) {
            setCashbackSubject(fallback.subject ?? "");
            setCashbackHtml(fallback.bodyHtml ?? "");
            setCashbackText(fallback.bodyText ?? "");
        } else if (type === EmailTemplateType.MANUAL_REFERRER_WELCOME) {
            setManualSubject(fallback.subject ?? "");
            setManualHtml(fallback.bodyHtml ?? "");
            setManualText(fallback.bodyText ?? "");
        }
    };

    const htmlFieldId =
        currentType === EmailTemplateType.CODE_PROMO
            ? "codePromoHtml"
            : currentType === EmailTemplateType.CASHBACK_CONFIRMATION
              ? "cashbackHtml"
              : "manualWelcomeHtml";
    const textFieldId =
        currentType === EmailTemplateType.CODE_PROMO
            ? "codePromoText"
            : currentType === EmailTemplateType.CASHBACK_CONFIRMATION
              ? "cashbackText"
              : "manualWelcomeText";

    return (
        <Page title="Templates d'emails">
            <BlockStack gap="400">
                {errorMessage && <Banner tone="critical">{errorMessage}</Banner>}
                {successMessage && <Banner tone="success">{successMessage}</Banner>}

                <Tabs tabs={templateTabs} selected={selectedTemplateTab} onSelect={setSelectedTemplateTab} fitted />

                <Card>
                    <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">
                                Contenu du template
                            </Text>
                            <form method="post">
                                <input type="hidden" name="templateType" value={currentType} />
                                <input type="hidden" name="intent" value="reset" />
                                <Button
                                    submit
                                    tone="critical"
                                    variant="plain"
                                    size="slim"
                                    loading={isResettingCurrent}
                                    onClick={() => applyDefaultsToState(currentType)}
                                >
                                    Restaurer le template par défaut
                                </Button>
                            </form>
                        </InlineStack>

                        <form method="post" id="template-save-form">
                            <input type="hidden" name="templateType" value={currentType} />
                            <input type="hidden" name="intent" value="save" />
                            <input type="hidden" name="subject" value={currentState.subject} readOnly />
                            <BlockStack gap="300">
                                <TextField
                                    label="Sujet de l'email"
                                    autoComplete="off"
                                    value={currentState.subject}
                                    onChange={(value) => currentState.setSubject(value)}
                                />

                                <Tabs tabs={editorTabs} selected={currentEditorTab} onSelect={changeEditorTab} />

                                {currentEditorTab === 0 && (
                                    <EmailPreview
                                        subject={currentState.subject}
                                        html={currentState.html}
                                        text={currentState.text}
                                        sampleVars={currentSamples}
                                        mode={currentPreviewMode}
                                        onModeChange={changePreviewMode}
                                        type={currentType}
                                    />
                                )}

                                <div style={{ display: currentEditorTab === 1 ? "block" : "none" }}>
                                    <BlockStack gap="150">
                                        <label htmlFor={htmlFieldId} style={{ fontWeight: 600, fontSize: "14px" }}>
                                            Contenu HTML
                                        </label>
                                        <textarea
                                            form="template-save-form"
                                            id={htmlFieldId}
                                            name="bodyHtml"
                                            value={currentState.html}
                                            onChange={(event) => currentState.setHtml(event.currentTarget.value)}
                                            rows={20}
                                            style={{
                                                fontFamily:
                                                    "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                                width: "100%",
                                                borderRadius: 8,
                                                border: "1px solid var(--p-color-border, #C9CCCF)",
                                                padding: "12px",
                                                minHeight: 280,
                                                backgroundColor: "#fff",
                                                resize: "vertical",
                                            }}
                                        />
                                    </BlockStack>
                                </div>

                                <InlineStack align="end" gap="200">
                                    <Button submit variant="primary" loading={isSavingCurrent}>
                                        Sauvegarder
                                    </Button>
                                </InlineStack>
                            </BlockStack>
                        </form>
                    </BlockStack>
                </Card>

    <Card>
                    <BlockStack gap="200">
                        <InlineStack align="space-between">
                            <Text as="h3" variant="headingSm">
                                Données de prévisualisation
                            </Text>
                            <Button size="slim" onClick={resetSamples}>
                                Réinitialiser
                            </Button>
                        </InlineStack>
                        <div
                            style={{
                                display: "grid",
                                gap: "12px",
                                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                            }}
                        >
                            {Object.entries(currentSamples).map(([key, value]) => {
                                const placeholderToken = `{{${key}}}`;
                                const hint = placeholders.find((placeholder) => placeholder.token === placeholderToken);
                                const label = hint ? `${hint.description} (${placeholderToken})` : key;

                                return (
                                    <TextField
                                        key={key}
                                        label={label}
                                        value={value}
                                        autoComplete="off"
                                        onChange={(newValue) => handleSampleChange(key, newValue)}
                                    />
                                );
                            })}
                        </div>
                    </BlockStack>
                </Card>

                <Card>
                    <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                            Variables disponibles
                        </Text>
                        <BlockStack gap="200">
                            {placeholders.map((placeholder) => (
                                <InlineStack key={placeholder.token} gap="200" align="start">
                                    <span
                                        style={{
                                            fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                            background: "#F6F7F8",
                                            borderRadius: 6,
                                            padding: "4px 8px",
                                            display: "inline-block",
                                        }}
                                    >
                                        {placeholder.token}
                                    </span>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        {placeholder.description}
                                    </Text>
                                </InlineStack>
                            ))}
                        </BlockStack>
                    </BlockStack>
                </Card>
            </BlockStack>
        </Page>
    );
}

