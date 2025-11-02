export enum EmailTemplateType {
    CODE_PROMO = "CODE_PROMO",
    CASHBACK_CONFIRMATION = "CASHBACK_CONFIRMATION",
    MANUAL_REFERRER_WELCOME = "MANUAL_REFERRER_WELCOME",
}

export enum EmailStatus {
    PENDING = "PENDING",
    SENT = "SENT",
    FAILED = "FAILED",
}

export type EmailTemplateTypeKey = keyof typeof EmailTemplateType;
export type EmailStatusKey = keyof typeof EmailStatus;

export type EmailTemplateVariable =
    | "firstName"
    | "lastName"
    | "code"
    | "workshopTitle"
    | "workshopQuantity"
    | "expiresAt"
    | "discountPercentage"
    | "cashbackAmount"
    | "shopUrl"
    | "refereeEmail"
    | "logoUrl"
    | "logoAlt";