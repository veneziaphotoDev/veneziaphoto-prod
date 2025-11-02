import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "app/shopify.server";
import { getDefaultTemplate, getEmailTemplate, upsertEmailTemplate } from "app/services/email.server";
import { EmailTemplateType } from "app/models/email";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);

    const codePromoTemplate = await getEmailTemplate(EmailTemplateType.CODE_PROMO);
    const cashbackConfirmationTemplate = await getEmailTemplate(EmailTemplateType.CASHBACK_CONFIRMATION);
    const manualReferrerTemplate = await getEmailTemplate(EmailTemplateType.MANUAL_REFERRER_WELCOME);

    return json({
        codePromoTemplate: codePromoTemplate ?? { subject: "", bodyHtml: "", bodyText: "" },
        cashbackConfirmationTemplate: cashbackConfirmationTemplate ?? { subject: "", bodyHtml: "", bodyText: "" },
        manualReferrerTemplate: manualReferrerTemplate ?? { subject: "", bodyHtml: "", bodyText: "" },
        defaults: {
            [EmailTemplateType.CODE_PROMO]: getDefaultTemplate(EmailTemplateType.CODE_PROMO),
            [EmailTemplateType.CASHBACK_CONFIRMATION]: getDefaultTemplate(EmailTemplateType.CASHBACK_CONFIRMATION),
            [EmailTemplateType.MANUAL_REFERRER_WELCOME]: getDefaultTemplate(
                EmailTemplateType.MANUAL_REFERRER_WELCOME,
            ),
        },
    });
};

function parseTemplateType(value: FormDataEntryValue | null): EmailTemplateType | null {
    if (typeof value !== "string") return null;
    if (
        value === EmailTemplateType.CODE_PROMO ||
        value === EmailTemplateType.CASHBACK_CONFIRMATION ||
        value === EmailTemplateType.MANUAL_REFERRER_WELCOME
    ) {
        return value;
    }
    return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
    await authenticate.admin(request);

    const formData = await request.formData();

    const type = parseTemplateType(formData.get("templateType"));
    const intent = formData.get("intent");
    const subjectRaw = formData.get("subject");
    const bodyHtmlRaw = formData.get("bodyHtml");
    const bodyTextRaw = formData.get("bodyText");

    if (!type) {
        return json({ error: "Type de template inconnu." }, { status: 400 });
    }

    if (intent === "reset") {
        const defaults = getDefaultTemplate(type);
        const template = await upsertEmailTemplate({
            type,
            subject: defaults.subject,
            bodyHtml: defaults.bodyHtml,
            bodyText: defaults.bodyText ?? null,
        });

        return json({
            success: true as const,
            message: "Template restauré aux valeurs par défaut.",
            template: {
                type: template.type,
                subject: template.subject,
                bodyHtml: template.bodyHtml,
                bodyText: template.bodyText ?? "",
            },
        });
    }

    if (typeof subjectRaw !== "string" || !subjectRaw.trim()) {
        return json({ error: "Le sujet est obligatoire." }, { status: 400 });
    }

    if (typeof bodyHtmlRaw !== "string" || !bodyHtmlRaw.trim()) {
        return json({ error: "Le contenu HTML est obligatoire." }, { status: 400 });
    }

    try {
        const template = await upsertEmailTemplate({
            type,
            subject: subjectRaw.trim(),
            bodyHtml: bodyHtmlRaw,
            bodyText: typeof bodyTextRaw === "string" ? bodyTextRaw : null,
        });

        return json({
            success: true as const,
            message: "Template mis à jour.",
            template: {
                type: template.type,
                subject: template.subject,
                bodyHtml: template.bodyHtml,
                bodyText: template.bodyText ?? "",
            },
        });
    } catch (error) {
        console.error("❌ Impossible de sauvegarder le template email:", error);
        return json(
            { error: "Impossible de sauvegarder le template pour le moment. Réessaie dans quelques instants." },
            { status: 500 },
        );
    }
};

