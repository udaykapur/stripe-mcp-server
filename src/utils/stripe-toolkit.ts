import Stripe from "stripe";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const OMITTED_KEYS = new Set([
  "secret",
  "client_secret",
  "fingerprint",
  "number",
  "cvc",
  "account_number",
  "routing_number",
]);

const EMAIL_KEYS = new Set(["email", "customer_email", "receipt_email", "support_email"]);
const PHONE_KEYS = new Set(["phone", "support_phone"]);
const ADDRESS_KEYS = new Set(["address", "billing_details", "shipping"]);
const URL_REDACT_KEYS = new Set(["hosted_invoice_url", "invoice_pdf", "receipt_url", "hosted_regulatory_receipt_url"]);
const FREE_TEXT_KEYS = new Set(["name", "description", "nickname", "footer", "statement_descriptor"]);
const require = createRequire(import.meta.url);
const stripePackageRoot = path.dirname(path.dirname(require.resolve("stripe")));

function loadStripeUnionValues(candidatePaths: string[], typeName: string): string[] {
  for (const relPath of candidatePaths) {
    const filePath = path.join(stripePackageRoot, relPath);

    let contents: string;
    try {
      contents = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const match = contents.match(new RegExp(`type\\s+${typeName}\\s*=([\\s\\S]*?);`));
    if (!match) {
      continue;
    }

    return [...match[1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!);
  }

  console.error(`stripe-mcp: ${typeName} not found in any candidate path. Validation disabled.`);
  return [];
}

const checkoutPaymentMethodTypes = new Set(
  loadStripeUnionValues(
    ["cjs/resources/Checkout/Sessions.d.ts", "types/Checkout/SessionsResource.d.ts"],
    "PaymentMethodType",
  ),
);
const webhookEnabledEvents = new Set(
  loadStripeUnionValues(
    ["cjs/resources/WebhookEndpoints.d.ts", "types/WebhookEndpointsResource.d.ts"],
    "EnabledEvent",
  ).filter((value) => value !== "*"),
);
const webhookApiVersions = new Set(
  loadStripeUnionValues(
    ["cjs/resources/WebhookEndpoints.d.ts", "types/WebhookEndpointsResource.d.ts"],
    "ApiVersion",
  ),
);
const balanceTransactionTypes = new Set(
  loadStripeUnionValues(
    ["cjs/resources/BalanceTransactions.d.ts", "types/BalanceTransactions.d.ts"],
    "Type",
  ),
);
const TERMINAL_ONLY_TYPES = new Set(["card_present", "interac_present"]);
const paymentMethodTypes = new Set(
  loadStripeUnionValues(
    ["cjs/resources/PaymentMethods.d.ts", "types/PaymentMethodsResource.d.ts"],
    "Type",
  ).filter((t) => !TERMINAL_ONLY_TYPES.has(t)),
);

export const currencySchema = z
  .string()
  .regex(/^[a-zA-Z]{3}$/, "Currency must be a three-letter ISO code.")
  .transform((value) => value.toLowerCase());

export const httpsUrlSchema = z
  .string()
  .url("Must be a valid URL.")
  .refine((value) => value.startsWith("https://"), "Must use HTTPS.");

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[A-Za-z0-9:_=-]+$/,
    "Idempotency key may only contain letters, numbers, colon, underscore, hyphen, and equals.",
  );

export const stripeLikeIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]{1,31}_[A-Za-z0-9_]+$/, "Must be a Stripe-style ID like ch_..., sub_..., or price_...");

export const checkoutPaymentMethodTypeSchema = z
  .string()
  .refine(
    (value) => checkoutPaymentMethodTypes.size === 0 || checkoutPaymentMethodTypes.has(value),
    "Must be a valid Stripe Checkout payment method type.",
  );

export const webhookEnabledEventSchema = z
  .string()
  .refine((value) => value !== "*", "Wildcard '*' is not allowed. Subscribe to specific event types.")
  .refine(
    (value) => webhookEnabledEvents.size === 0 || webhookEnabledEvents.has(value),
    "Must be a valid explicit Stripe webhook event type.",
  );

export const webhookApiVersionSchema = z
  .string()
  .refine(
    (value) => webhookApiVersions.size === 0 || webhookApiVersions.has(value),
    "Must be a valid Stripe API version.",
  );

export const balanceTransactionTypeSchema = z
  .string()
  .refine(
    (value) => balanceTransactionTypes.size === 0 || balanceTransactionTypes.has(value),
    "Must be a valid Stripe balance transaction type.",
  );

export const paymentMethodTypeSchema = z
  .string()
  .refine(
    (value) => paymentMethodTypes.size === 0 || paymentMethodTypes.has(value),
    "Must be a valid Stripe payment method type.",
  );

export function stripeIdSchema(prefix: string): z.ZodString {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return z
    .string()
    .regex(
      new RegExp(`^${escapedPrefix}[A-Za-z0-9_]+$`),
      `Must be a valid Stripe ID starting with ${prefix}`,
    );
}

export function buildStripeRequestOptions(
  idempotencyKey?: string,
): Stripe.RequestOptions | undefined {
  if (!idempotencyKey) {
    return undefined;
  }

  return { idempotencyKey };
}

export function stripeSuccessResult(
  data: unknown,
  notes?: string[],
): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          notes && notes.length > 0
            ? { data: sanitizeStripeResponse(data), notes }
            : sanitizeStripeResponse(data),
          null,
          2,
        ),
      },
    ],
  };
}

export function stripeErrorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: formatStripeError(error) }, null, 2),
      },
    ],
    isError: true,
  };
}

export function formatStripeError(error: unknown): Record<string, unknown> {
  if (isStripeLikeError(error)) {
    const type = typeof error.type === "string" ? error.type : "StripeError";

    return {
      type,
      message: sanitiseErrorMessage(error.message),
      code: typeof error.code === "string" ? error.code : undefined,
      param: typeof error.param === "string" ? error.param : undefined,
      request_id:
        typeof error.requestId === "string"
          ? error.requestId
          : typeof error.request_id === "string"
            ? error.request_id
            : undefined,
      retryable: isRetryableStripeErrorType(type),
    };
  }

  if (error instanceof Error) {
    return {
      type: error.name,
      message: sanitiseErrorMessage(error.message),
      retryable: false,
    };
  }

  return {
    type: "UnknownError",
    message: sanitiseErrorMessage(String(error)),
    retryable: false,
  };
}

export function sanitizeStripeResponse(data: unknown): unknown {
  return sanitizeValue(data);
}

function sanitizeValue(data: unknown, keyName?: string): unknown {
  if (data == null) {
    return data;
  }

  if (keyName === "metadata") {
    return sanitizeMetadata(data);
  }

  if (Array.isArray(data)) {
    return data.map((entry) => sanitizeValue(entry));
  }

  if (typeof data !== "object") {
    return sanitizeScalarValue(data, keyName);
  }

  const record = data as Record<string, unknown>;
  const objectType = typeof record.object === "string" ? record.object : undefined;

  if (!objectType) {
    return sanitizeGenericObject(record);
  }

  switch (objectType) {
    case "list":
      return {
        object: "list",
        has_more: record.has_more,
        url: record.url,
        data: Array.isArray(record.data)
          ? record.data.map((entry) => sanitizeValue(entry))
          : [],
      };
    case "search_result":
      return {
        object: "search_result",
        has_more: record.has_more,
        next_page: record.next_page,
        url: record.url,
        data: Array.isArray(record.data)
          ? record.data.map((entry) => sanitizeValue(entry))
          : [],
      };
    case "customer":
      return pickDefined({
        object: "customer",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        deleted: record.deleted,
        email: maskEmail(record.email),
        name: maskFreeText(record.name),
        phone: maskPhone(record.phone),
        description: maskFreeText(record.description),
        delinquent: record.delinquent,
        balance: record.balance,
        currency: record.currency,
        invoice_prefix: record.invoice_prefix,
        metadata: sanitizeMetadata(record.metadata),
        invoice_settings: sanitizeInvoiceSettings(record.invoice_settings),
      });
    case "payment_intent":
      return pickDefined({
        object: "payment_intent",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        amount: record.amount,
        amount_capturable: record.amount_capturable,
        amount_received: record.amount_received,
        currency: record.currency,
        status: record.status,
        capture_method: record.capture_method,
        confirmation_method: record.confirmation_method,
        customer: sanitizeValue(record.customer),
        payment_method: sanitizeValue(record.payment_method),
        latest_charge: sanitizeValue(record.latest_charge),
        receipt_email: maskEmail(record.receipt_email),
        description: maskFreeText(record.description),
        metadata: sanitizeMetadata(record.metadata),
      });
    case "payment_method":
      return pickDefined({
        object: "payment_method",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        type: record.type,
        customer: sanitizeValue(record.customer),
        billing_details: record.billing_details
          ? { redacted: true }
          : undefined,
        card: sanitizeCard(record.card),
        us_bank_account: sanitizeBankAccount(record.us_bank_account),
      });
    case "charge":
      return pickDefined({
        object: "charge",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        amount: record.amount,
        amount_captured: record.amount_captured,
        amount_refunded: record.amount_refunded,
        currency: record.currency,
        status: record.status,
        paid: record.paid,
        captured: record.captured,
        refunded: record.refunded,
        customer: sanitizeValue(record.customer),
        payment_intent: sanitizeValue(record.payment_intent),
        payment_method: sanitizeValue(record.payment_method),
        receipt_email: maskEmail(record.receipt_email),
        description: maskFreeText(record.description),
      });
    case "subscription":
      return pickDefined({
        object: "subscription",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        customer: sanitizeValue(record.customer),
        status: record.status,
        cancel_at: record.cancel_at,
        canceled_at: record.canceled_at,
        cancel_at_period_end: record.cancel_at_period_end,
        collection_method: record.collection_method,
        default_payment_method: sanitizeValue(record.default_payment_method),
        latest_invoice: sanitizeValue(record.latest_invoice),
        items: sanitizeSubscriptionItems(record.items),
        metadata: sanitizeMetadata(record.metadata),
      });
    case "product":
      return pickDefined({
        object: "product",
        id: record.id,
        created: record.created,
        updated: record.updated,
        livemode: record.livemode,
        active: record.active,
        name: maskFreeText(record.name),
        description: maskFreeText(record.description),
        default_price: sanitizeValue(record.default_price),
        metadata: sanitizeMetadata(record.metadata),
      });
    case "price":
      return pickDefined({
        object: "price",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        active: record.active,
        currency: record.currency,
        unit_amount: record.unit_amount,
        billing_scheme: record.billing_scheme,
        product: sanitizeValue(record.product),
        recurring: sanitizeValue(record.recurring),
        nickname: maskFreeText(record.nickname),
        metadata: sanitizeMetadata(record.metadata),
      });
    case "invoice":
      return pickDefined({
        object: "invoice",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        customer: sanitizeValue(record.customer),
        parent: sanitizeInvoiceParent(record.parent),
        status: record.status,
        collection_method: record.collection_method,
        amount_due: record.amount_due,
        amount_paid: record.amount_paid,
        amount_remaining: record.amount_remaining,
        total: record.total,
        currency: record.currency,
        due_date: record.due_date,
        hosted_invoice_url: record.hosted_invoice_url ? { redacted: true } : undefined,
        invoice_pdf: record.invoice_pdf ? { redacted: true } : undefined,
        payment_intent: sanitizeValue(record.payment_intent),
        description: maskFreeText(record.description),
        metadata: sanitizeMetadata(record.metadata),
      });
    case "invoiceitem":
      return pickDefined({
        object: "invoiceitem",
        id: record.id,
        date: record.date,
        livemode: record.livemode,
        customer: sanitizeValue(record.customer),
        invoice: sanitizeValue(record.invoice),
        amount: record.amount,
        currency: record.currency,
        description: maskFreeText(record.description),
        pricing: sanitizeValue(record.pricing),
        quantity: record.quantity,
        metadata: sanitizeMetadata(record.metadata),
      });
    case "refund":
      return pickDefined({
        object: "refund",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        amount: record.amount,
        currency: record.currency,
        charge: sanitizeValue(record.charge),
        payment_intent: sanitizeValue(record.payment_intent),
        reason: record.reason,
        status: record.status,
        metadata: sanitizeMetadata(record.metadata),
      });
    case "checkout.session":
      return pickDefined({
        object: "checkout.session",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        url: record.url,
        mode: record.mode,
        status: record.status,
        payment_status: record.payment_status,
        expires_at: record.expires_at,
        customer: sanitizeValue(record.customer),
        customer_email: maskEmail(record.customer_email),
        payment_intent: sanitizeValue(record.payment_intent),
        subscription: sanitizeValue(record.subscription),
      });
    case "coupon":
      return pickDefined({
        object: "coupon",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        name: maskFreeText(record.name),
        valid: record.valid,
        percent_off: record.percent_off,
        amount_off: record.amount_off,
        currency: record.currency,
        duration: record.duration,
        duration_in_months: record.duration_in_months,
        max_redemptions: record.max_redemptions,
        times_redeemed: record.times_redeemed,
        redeem_by: record.redeem_by,
        metadata: sanitizeMetadata(record.metadata),
      });
    case "balance":
      return pickDefined({
        object: "balance",
        livemode: record.livemode,
        available: sanitizeMoneyRows(record.available),
        pending: sanitizeMoneyRows(record.pending),
        connect_reserved: sanitizeMoneyRows(record.connect_reserved),
      });
    case "balance_transaction":
      return pickDefined({
        object: "balance_transaction",
        id: record.id,
        created: record.created,
        amount: record.amount,
        currency: record.currency,
        fee: record.fee,
        net: record.net,
        source: sanitizeValue(record.source),
        status: record.status,
        type: record.type,
        reporting_category: record.reporting_category,
        description: maskFreeText(record.description),
      });
    case "payout":
      return pickDefined({
        object: "payout",
        id: record.id,
        created: record.created,
        arrival_date: record.arrival_date,
        amount: record.amount,
        currency: record.currency,
        method: record.method,
        status: record.status,
        description: maskFreeText(record.description),
      });
    case "dispute":
      return pickDefined({
        object: "dispute",
        id: record.id,
        created: record.created,
        amount: record.amount,
        currency: record.currency,
        charge: sanitizeValue(record.charge),
        payment_intent: sanitizeValue(record.payment_intent),
        reason: record.reason,
        status: record.status,
        due_by: record.due_by,
      });
    case "account":
      return pickDefined({
        object: "account",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        business_type: record.business_type,
        country: record.country,
        default_currency: record.default_currency,
        charges_enabled: record.charges_enabled,
        payouts_enabled: record.payouts_enabled,
        details_submitted: record.details_submitted,
        email: maskEmail(record.email),
        business_profile: sanitizeBusinessProfile(record.business_profile),
        capabilities: sanitizeValue(record.capabilities),
      });
    case "event":
      return pickDefined({
        object: "event",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        type: record.type,
        api_version: record.api_version,
        pending_webhooks: record.pending_webhooks,
        request: sanitizeValue(record.request),
        data: sanitizeEventData(record.data),
      });
    case "webhook_endpoint":
      return pickDefined({
        object: "webhook_endpoint",
        id: record.id,
        created: record.created,
        livemode: record.livemode,
        url: sanitiseWebhookUrl(record.url),
        status: record.status,
        api_version: record.api_version,
        application: record.application,
        description: maskFreeText(record.description),
        enabled_events: sanitizeValue(record.enabled_events),
        metadata: sanitizeMetadata(record.metadata),
        secret_redacted: Object.prototype.hasOwnProperty.call(record, "secret")
          ? true
          : undefined,
      });
    default:
      return sanitizeUnknownStripeObject(record);
  }
}

function sanitizeGenericObject(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (OMITTED_KEYS.has(key)) {
      continue;
    }

    if (EMAIL_KEYS.has(key)) {
      result[key] = maskEmail(value);
      continue;
    }

    if (PHONE_KEYS.has(key)) {
      result[key] = maskPhone(value);
      continue;
    }

    if (ADDRESS_KEYS.has(key)) {
      result[key] = value ? { redacted: true } : value;
      continue;
    }

    if (URL_REDACT_KEYS.has(key)) {
      result[key] = value ? { redacted: true } : value;
      continue;
    }

    if (FREE_TEXT_KEYS.has(key)) {
      result[key] = maskFreeText(value);
      continue;
    }

    if (key === "url" && typeof value === "string") {
      result[key] = sanitiseWebhookUrl(value);
      continue;
    }

    result[key] = sanitizeValue(value, key);
  }

  return result;
}

function sanitizeScalarValue(value: unknown, keyName?: string): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (keyName && EMAIL_KEYS.has(keyName)) {
    return maskEmail(value);
  }

  if (keyName && PHONE_KEYS.has(keyName)) {
    return maskPhone(value);
  }

  if (keyName && FREE_TEXT_KEYS.has(keyName)) {
    return maskFreeText(value);
  }

  return value;
}

function sanitizeMetadata(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (keys.length === 0) {
    return undefined;
  }

  return {
    redacted: true,
    keys,
  };
}

function sanitizeUnknownStripeObject(record: Record<string, unknown>): Record<string, unknown> {
  return pickDefined({
    object: record.object,
    id: record.id,
    created: record.created,
    livemode: record.livemode,
    deleted: record.deleted,
    status: record.status,
    redacted: true,
  });
}

function sanitizeBusinessProfile(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return pickDefined({
    name: maskFreeText(record.name),
    support_email: maskEmail(record.support_email),
    support_phone: maskPhone(record.support_phone),
    url: record.url,
  });
}

function sanitizeEventData(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return pickDefined({
    object: sanitizeValue(record.object),
    previous_attributes: sanitizeValue(record.previous_attributes),
  });
}

function sanitizeInvoiceSettings(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return pickDefined({
    default_payment_method: sanitizeValue(record.default_payment_method),
    footer: maskFreeText(record.footer),
  });
}

function sanitizeInvoiceParent(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const subDetails = record.subscription_details as Record<string, unknown> | null | undefined;
  return pickDefined({
    type: record.type,
    subscription_details: subDetails
      ? pickDefined({
          subscription: typeof subDetails.subscription === "string"
            ? subDetails.subscription
            : sanitizeValue(subDetails.subscription),
        })
      : undefined,
  });
}

function sanitizeSubscriptionItems(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const data = Array.isArray(record.data)
    ? record.data.map((item) => {
        const itemRecord = item as Record<string, unknown>;
        return pickDefined({
          id: itemRecord.id,
          price: sanitizeValue(itemRecord.price),
          quantity: itemRecord.quantity,
          current_period_start: itemRecord.current_period_start,
          current_period_end: itemRecord.current_period_end,
        });
      })
    : undefined;

  return pickDefined({ object: record.object, data });
}

function sanitizeCard(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return pickDefined({
    brand: record.brand,
    country: record.country,
    exp_month: record.exp_month,
    exp_year: record.exp_year,
    funding: record.funding,
    last4: record.last4,
  });
}

function sanitizeBankAccount(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return pickDefined({
    account_holder_type: record.account_holder_type,
    bank_name: record.bank_name,
    last4: record.last4,
  });
}

function sanitizeMoneyRows(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((row) => {
    const record = row as Record<string, unknown>;
    return pickDefined({
      amount: record.amount,
      currency: record.currency,
      source_types: sanitizeValue(record.source_types),
    });
  });
}

function maskEmail(value: unknown): unknown {
  if (typeof value !== "string" || !value.includes("@")) {
    return value;
  }

  const [localPart, domain] = value.split("@");
  if (!localPart || !domain) {
    return value;
  }

  const visible = localPart.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, localPart.length - visible.length))}@${domain}`;
}

function maskPhone(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) {
    return "***";
  }

  return `***${digits.slice(-4)}`;
}

function maskFreeText(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (value.length <= 40) {
    return value;
  }

  return `${value.slice(0, 40)}... [truncated, ${value.length} chars]`;
}

function sanitiseErrorMessage(message: unknown): unknown {
  if (typeof message !== "string") {
    return message;
  }
  return message
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email redacted]")
    .replace(/https?:\/\/[^\s"']+/g, "[url redacted]");
}

function sanitiseWebhookUrl(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return "[invalid url redacted]";
  }
}

function pickDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function isStripeLikeError(error: unknown): error is Stripe.StripeRawError & {
  requestId?: string;
  request_id?: string;
} {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  return (
    typeof record.message === "string" &&
    typeof record.type === "string"
  );
}

function isRetryableStripeErrorType(type: string): boolean {
  return [
    "StripeAPIError",
    "StripeConnectionError",
    "StripeRateLimitError",
    "api_error",
    "rate_limit_error",
  ].includes(type);
}
