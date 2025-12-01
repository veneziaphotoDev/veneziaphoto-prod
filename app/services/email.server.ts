// app/services/email.server.ts
import prisma from "app/db.server";
import type { EmailTemplateType as PrismaEmailTemplateType } from "@prisma/client";
import { EmailStatus, EmailTemplateType } from "app/models/email";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const DEFAULT_LOGO_URL =
  "https://veneziaphoto.myshopify.com/cdn/shop/files/logo--to-replace_b27e332b-e510-4edf-a148-a60c4fcecf48.svg?v=1762347140&width=261";
const DEFAULT_LOGO_ALT = "Venezia Photo";

export type TemplateVariables = {
  firstName?: string | null;
  lastName?: string | null;
  code?: string;
  workshopTitle?: string | null;
  workshopQuantity?: number | string;
  expiresAt?: string | null;
  discountPercentage?: number | string;
  cashbackAmount?: number | string;
  shopUrl?: string | null;
  refereeEmail?: string | null;
  logoUrl?: string | null;
  logoAlt?: string | null;
};

function replaceVariables(template: string, variables: TemplateVariables): string {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value ?? ""));
  });
  return result;
}

function toPrismaTemplateType(type: EmailTemplateType): PrismaEmailTemplateType {
  return type as PrismaEmailTemplateType;
}

export async function getEmailTemplate(type: EmailTemplateType) {
  let template = await prisma.emailTemplate.findUnique({ where: { type: toPrismaTemplateType(type) } });

  if (!template) {
    const defaultTemplate = getDefaultTemplate(type);
    template = await prisma.emailTemplate.create({
      data: {
        type: toPrismaTemplateType(type),
        subject: defaultTemplate.subject,
        bodyHtml: defaultTemplate.bodyHtml,
        bodyText: defaultTemplate.bodyText,
      },
    });
  }

  return template;
}

export async function upsertEmailTemplate({
  type,
  subject,
  bodyHtml,
  bodyText,
}: {
  type: EmailTemplateType;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
}) {
  return prisma.emailTemplate.upsert({
    where: { type: toPrismaTemplateType(type) },
    update: {
      subject,
      bodyHtml,
      bodyText: bodyText?.trim() ? bodyText : null,
    },
    create: {
      type: toPrismaTemplateType(type),
      subject,
      bodyHtml,
      bodyText: bodyText?.trim() ? bodyText : null,
    },
  });
}

export function getDefaultTemplate(type: EmailTemplateType) {
  switch (type) {
    case EmailTemplateType.CODE_PROMO:
      return {
        subject: "Votre code de parrainage est prêt !",
        bodyHtml: `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #111;
      background: #fff;
      margin: 0 auto;
      max-width: 640px;
      padding: 0;
      line-height: 1.6;
    }
    .header {
      background: #000;
      padding: 32px 0;
      text-align: center;
    }
    .header img {
      max-width: 160px;
      height: auto;
    }
    .content {
      padding: 48px 32px;
    }
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 20px;
      font-weight: 500;
      margin-top: 40px;
      margin-bottom: 16px;
    }
    p {
      font-size: 16px;
      margin: 8px 0;
      color: #222;
    }
    .code {
      font-size: 26px;
      font-weight: 600;
      text-align: center;
      letter-spacing: 2px;
      margin: 32px 0;
    }
    .section {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e5e5;
    }
    .footer {
      text-align: center;
      font-size: 14px;
      color: #666;
      margin: 64px 0 24px;
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="{{logoUrl}}" alt="{{logoAlt}}" />
  </div>

  <div class="content">
<h1>Hello {{firstName}},</h1>

<p>We were truly delighted to welcome you to the <strong>{{workshopTitle}}</strong> workshop.</p>
<p>Thank you for being part of the Venezia Photo community.</p>

<h2>Your referral code</h2>

<div class="code">{{code}}</div>

<div class="section">
  <p>Your referred friends will receive <strong>{{discountPercentage}}</strong> off their first purchase, as long as they have never attended a Venezia Photo workshop before.</p>
  <p>For each successful referral, you will receive <strong>{{cashbackAmount}}</strong> in cashback, valid on your next purchase on our new website and credited directly to the card you originally used.</p>
  <p>This referral code is valid until <strong>{{expiresAt}}</strong>.</p>
</div>

<div class="footer">
  <p>We look forward to welcoming you again very soon,</p>
  <p>The Venezia Photo Team</p>
</div>
  </div>
</body>
</html>`.trim(),
        bodyText: `
Bonjour {{firstName}},

Merci d’avoir participé à notre workshop {{workshopTitle}}.

Votre code : {{code}}

Vos filleuls bénéficient de {{discountPercentage}} de réduction.
Vous recevez {{cashbackAmount}} pour chaque utilisation.
Valable jusqu’au {{expiresAt}}.

À bientôt,
L’équipe Venezia Photo
`.trim(),
      };

    case EmailTemplateType.CASHBACK_CONFIRMATION:
      return {
        subject: "Cashback confirmé !",
        bodyHtml: `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #111;
      background: #fff;
      margin: 0 auto;
      max-width: 640px;
      padding: 0;
      line-height: 1.6;
    }
    .header {
      background: #000;
      padding: 32px 0;
      text-align: center;
    }
    .header img {
      max-width: 160px;
      height: auto;
    }
    .content {
      padding: 48px 32px;
    }
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 22px;
      font-weight: 500;
      margin: 32px 0 16px;
    }
    p {
      font-size: 16px;
      margin: 8px 0;
      color: #222;
    }
    .highlight {
      font-size: 22px;
      font-weight: 600;
      text-align: center;
      margin: 32px 0;
    }
    .footer {
      text-align: center;
      font-size: 14px;
      color: #666;
      margin: 64px 0 24px;
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="{{logoUrl}}" alt="{{logoAlt}}" />
  </div>

  <div class="content">
   <h1>Hello {{firstName}},</h1>

<h2>Cashback confirmed</h2>

<p>Great news — your cashback has been successfully credited following the referral of <strong>{{refereeEmail}}</strong>.</p>

<div class="highlight">{{cashbackAmount}}</div>

<p>Thank you sincerely for your trust, your support, and your continued commitment to the Venezia Photo community.</p>

<div class="footer">
  <p>Warm regards,</p>
  <p>The Venezia Photo Team</p>
</div>

  </div>
</body>
</html>`.trim(),
        bodyText: `
Bonjour {{firstName}},

Votre cashback de {{cashbackAmount}} a été confirmé pour {{refereeEmail}}.

Merci pour votre confiance !
L'équipe Venezia Photo
`.trim(),
      };

    case EmailTemplateType.MANUAL_REFERRER_WELCOME:
      return {
        subject: "Bienvenue dans le programme de parrainage",
        bodyHtml: `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #111;
      background: #fff;
      margin: 0 auto;
      max-width: 640px;
      padding: 0;
      line-height: 1.6;
    }
    .header {
      background: #000;
      padding: 32px 0;
      text-align: center;
    }
    .header img {
      max-width: 160px;
      height: auto;
    }
    .content {
      padding: 48px 32px;
    }
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 20px;
      font-weight: 500;
      margin-top: 32px;
      margin-bottom: 16px;
    }
    p {
      font-size: 16px;
      margin: 8px 0;
      color: #222;
    }
    .code {
      font-size: 26px;
      font-weight: 600;
      text-align: center;
      letter-spacing: 2px;
      margin: 32px 0;
    }
    ul {
      margin: 16px 0;
      padding-left: 20px;
    }
    li {
      margin: 8px 0;
      font-size: 16px;
    }
    .footer {
      text-align: center;
      font-size: 14px;
      color: #666;
      margin: 64px 0 24px;
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="{{logoUrl}}" alt="{{logoAlt}}" />
  </div>

  <div class="content">
  <h1>Hello {{firstName}},</h1>
<p>Welcome to the Venezia Photo referral program.</p>

<h2>Your personal code</h2>
<div class="code">{{code}}</div>

<ul>
  <li>Your referred friends receive <strong>{{discountPercentage}}</strong> off their purchase</li>
  <li>You receive <strong>{{cashbackAmount}}</strong> for each successful referral</li>
  <li>This code is valid until <strong>{{expiresAt}}</strong></li>
</ul>

<p>Share this code with your friends and invite them to discover our workshops.</p>

<div class="footer">
  <p>Thank you,</p>
  <p>The Venezia Photo Team</p>
</div>

  </div>
</body>
</html>`.trim(),
        bodyText: `
Bonjour {{firstName}},

Bienvenue dans le programme de parrainage Venezia Photo.

Votre code : {{code}}
- Vos filleuls bénéficient de {{discountPercentage}} de réduction
- Vous recevez {{cashbackAmount}} pour chaque inscription validée
- Code valable jusqu’au {{expiresAt}}

Partagez ce code avec vos proches et faites découvrir nos workshops.

L’équipe Venezia Photo
`.trim(),
      };

    default:
      throw new Error(`Type de template inconnu: ${type}`);
  }
}

export async function sendEmail({
  to,
  templateType,
  variables,
  codeId,
  referrerId,
}: {
  to: string;
  templateType: EmailTemplateType;
  variables: TemplateVariables;
  codeId?: string;
  referrerId: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("⚠️ RESEND_API_KEY non configurée.");
    return prisma.emailLog.create({
      data: {
        referrerId,
        codeId: codeId ?? null,
        templateType: toPrismaTemplateType(templateType),
        recipientEmail: to,
        subject: "Erreur de configuration",
        status: EmailStatus.FAILED,
        errorMessage: "RESEND_API_KEY non configurée",
      },
    });
  }

  const template = await getEmailTemplate(templateType);
  const subject = replaceVariables(template.subject, variables);
  const html = replaceVariables(template.bodyHtml, variables);
  const text = template.bodyText ? replaceVariables(template.bodyText, variables) : undefined;

  const log = await prisma.emailLog.create({
    data: {
      referrerId,
      codeId: codeId ?? null,
      templateType: toPrismaTemplateType(templateType),
      recipientEmail: to,
      subject,
      status: EmailStatus.PENDING,
    },
  });

  try {
    const sent = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
      to,
      subject,
      html,
      text,
    });

    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: EmailStatus.SENT, resendId: sent.data?.id || null, sentAt: new Date() },
    });
    return sent;
  } catch (error) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: EmailStatus.FAILED, errorMessage: String(error) },
    });
    throw error;
  }
}

export async function sendCashbackConfirmationEmail({
  referrerId,
  referrerEmail,
  firstName,
  lastName,
  cashbackAmount,
  refereeEmail,
}: {
  referrerId: string;
  referrerEmail?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  cashbackAmount: number;
  refereeEmail?: string | null;
}) {
  if (!referrerEmail) {
    console.warn(
      `⚠️ Impossible d'envoyer l'email de confirmation cashback : aucun email pour le parrain ${referrerId}`,
    );
    return;
  }

  await sendEmail({
    to: referrerEmail,
    templateType: EmailTemplateType.CASHBACK_CONFIRMATION,
    variables: {
      firstName,
      lastName,
      cashbackAmount,
      refereeEmail,
      logoUrl: DEFAULT_LOGO_URL,
      logoAlt: DEFAULT_LOGO_ALT,
    },
    referrerId,
  });
}

type SendPromoCodeEmailParams = {
  referrerId: string;
  codeId: string;
  referrerEmail?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  code: string;
  workshopTitle?: string | null;
  workshopQuantity?: number | null;
  expiresAt?: Date | null;
  discountPercentage: number;
  cashbackAmount: number;
  shopUrl?: string | null;
};

export async function sendPromoCodeEmail({
  referrerId,
  codeId,
  referrerEmail,
  firstName,
  lastName,
  code,
  workshopTitle,
  workshopQuantity,
  expiresAt,
  discountPercentage,
  cashbackAmount,
  shopUrl,
}: SendPromoCodeEmailParams) {
  if (!referrerEmail) {
    console.warn(
      `⚠️ Impossible d'envoyer l'email de code promo : aucun email pour le parrain ${referrerId}`,
    );
    return;
  }

  const formattedDiscount =
    Number.isFinite(discountPercentage) && discountPercentage > 0
      ? `${(discountPercentage * 100).toFixed(0)}%`
      : undefined;

  const formattedCashback = Number.isFinite(cashbackAmount)
    ? new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(cashbackAmount)
    : undefined;

  const formattedExpiry =
    expiresAt instanceof Date
      ? expiresAt.toLocaleDateString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
      : null;

  await sendEmail({
    to: referrerEmail,
    templateType: EmailTemplateType.CODE_PROMO,
    variables: {
      firstName,
      lastName,
      code,
      workshopTitle,
      workshopQuantity: workshopQuantity ?? undefined,
      expiresAt: formattedExpiry,
      discountPercentage: formattedDiscount ?? discountPercentage,
      cashbackAmount: formattedCashback ?? cashbackAmount,
      shopUrl: shopUrl ?? undefined,
      logoUrl: DEFAULT_LOGO_URL,
      logoAlt: DEFAULT_LOGO_ALT,
    },
    referrerId,
    codeId,
  });
}

type SendManualReferrerWelcomeEmailParams = {
  referrerId: string;
  referrerEmail?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  code: string;
  codeId?: string | null;
  expiresAt?: Date | null;
  discountPercentage: number;
  cashbackAmount: number;
  shopUrl?: string | null;
};

export async function sendManualReferrerWelcomeEmail({
  referrerId,
  referrerEmail,
  firstName,
  lastName,
  code,
  codeId,
  expiresAt,
  discountPercentage,
  cashbackAmount,
  shopUrl,
}: SendManualReferrerWelcomeEmailParams) {
  if (!referrerEmail) {
    console.warn(
      `⚠️ Impossible d'envoyer l'email de bienvenue parrain : aucun email pour le parrain ${referrerId}`,
    );
    return;
  }

  const formattedDiscount =
    Number.isFinite(discountPercentage) && discountPercentage > 0
      ? `${(discountPercentage * 100).toFixed(0)}%`
      : undefined;

  const formattedCashback = Number.isFinite(cashbackAmount)
    ? new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(cashbackAmount)
    : undefined;

  const formattedExpiry =
    expiresAt instanceof Date
      ? expiresAt.toLocaleDateString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
      : null;

  await sendEmail({
    to: referrerEmail,
    templateType: EmailTemplateType.MANUAL_REFERRER_WELCOME,
    variables: {
      firstName,
      lastName,
      code,
      expiresAt: formattedExpiry,
      discountPercentage: formattedDiscount ?? discountPercentage,
      cashbackAmount: formattedCashback ?? cashbackAmount,
      shopUrl: shopUrl ?? undefined,
      logoUrl: DEFAULT_LOGO_URL,
      logoAlt: DEFAULT_LOGO_ALT,
    },
    referrerId,
    codeId: codeId ?? undefined,
  });
}
