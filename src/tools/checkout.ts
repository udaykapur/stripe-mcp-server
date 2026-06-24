/**
 * Checkout tools - Stripe Checkout Sessions and Coupons.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Stripe from "stripe";
import { stripe } from "../stripe-client.js";
import {
  buildStripeRequestOptions,
  checkoutPaymentMethodTypeSchema,
  currencySchema,
  httpsUrlSchema,
  idempotencyKeySchema,
  stripeErrorResult,
  stripeIdSchema,
  stripeSuccessResult,
} from "../utils/stripe-toolkit.js";

const checkoutLineItemSchema = z.object({
  price: stripeIdSchema("price_").describe("Price ID (price_...)"),
  quantity: z.number().int().positive().describe("Quantity"),
});

export const createCheckoutSessionSchema = z
  .object({
    mode: z
      .enum(["payment", "subscription", "setup"])
      .describe('"payment" for one-time, "subscription" for recurring, "setup" for saving payment method'),
    line_items: z
      .array(checkoutLineItemSchema)
      .max(20)
      .optional()
      .describe("Line items, max 20 (required for payment and subscription modes)"),
    success_url: httpsUrlSchema.describe("URL to redirect after successful payment"),
    cancel_url: httpsUrlSchema.optional().describe("URL to redirect if customer cancels"),
    customer: stripeIdSchema("cus_").optional().describe("Existing customer ID"),
    customer_email: z
      .string()
      .email()
      .optional()
      .describe("Pre-fill email (ignored if customer is set)"),
    metadata: z.record(z.string(), z.string()).optional().describe("Session metadata"),
    allow_promotion_codes: z.boolean().optional().describe("Allow promotion code entry"),
    trial_period_days: z.number().int().positive().optional().describe("Trial days (subscription mode only)"),
    payment_method_types: z.array(checkoutPaymentMethodTypeSchema).optional().describe('Payment methods (e.g. ["card", "us_bank_account"])'),
    expires_at: z.number().int().optional().describe("Session expiration as Unix timestamp (30min to 24hr from now)"),
    idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
  })
  .superRefine((value, ctx) => {
    if ((value.mode === "payment" || value.mode === "subscription") && (!value.line_items || value.line_items.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "line_items is required for payment and subscription checkout sessions.",
        path: ["line_items"],
      });
    }

    if (value.mode === "setup" && value.line_items && value.line_items.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "line_items is not allowed for setup checkout sessions.",
        path: ["line_items"],
      });
    }

    if (value.trial_period_days !== undefined && value.mode !== "subscription") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trial_period_days is only valid for subscription checkout sessions.",
        path: ["trial_period_days"],
      });
    }

    if (value.expires_at !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (value.expires_at < now + 30 * 60 || value.expires_at > now + 24 * 60 * 60) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "expires_at must be between 30 minutes and 24 hours from now.",
          path: ["expires_at"],
        });
      }
    }
  });

export const createCouponSchema = z
  .object({
    percent_off: z.number().min(1).max(100).optional().describe("Percentage discount (use this OR amount_off)"),
    amount_off: z.number().int().positive().optional().describe("Fixed amount discount in smallest currency unit"),
    currency: currencySchema.optional().describe("Currency for amount_off (required if using amount_off)"),
    duration: z.enum(["forever", "once", "repeating"]).describe("How long the coupon applies"),
    duration_in_months: z.number().int().positive().optional().describe('Number of months (required when duration is "repeating")'),
    name: z.string().optional().describe("Coupon display name"),
    max_redemptions: z.number().int().positive().optional().describe("Max times this coupon can be redeemed"),
    redeem_by: z.number().int().optional().describe("Unix timestamp after which coupon can no longer be redeemed"),
    metadata: z.record(z.string(), z.string()).optional().describe("Metadata"),
    idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
  })
  .superRefine((value, ctx) => {
    const hasPercent = value.percent_off !== undefined;
    const hasAmount = value.amount_off !== undefined;

    if (Number(hasPercent) + Number(hasAmount) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of percent_off or amount_off.",
        path: ["percent_off"],
      });
    }

    if (hasAmount && value.currency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "currency is required when amount_off is set.",
        path: ["currency"],
      });
    }

    if (!hasAmount && value.currency !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "currency is only valid when amount_off is set.",
        path: ["currency"],
      });
    }

    if (value.duration === "repeating" && value.duration_in_months === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duration_in_months is required when duration is "repeating".',
        path: ["duration_in_months"],
      });
    }

    if (value.duration !== "repeating" && value.duration_in_months !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duration_in_months is only valid when duration is "repeating".',
        path: ["duration_in_months"],
      });
    }
  });

export function registerCheckoutTools(server: McpServer): void {
  server.registerTool(
    "create_checkout_session",
    {
      title: "Create Checkout Session",
      description:
        "Create a Stripe Checkout session. Returns a URL to redirect customers to Stripe-hosted payment page.",
      inputSchema: createCheckoutSessionSchema,
    },
    async (params) => {
      try {
        const session = await stripe.checkout.sessions.create(
          {
            mode: params.mode,
            line_items: params.line_items,
            success_url: params.success_url,
            cancel_url: params.cancel_url,
            customer: params.customer,
            customer_email: params.customer_email,
            metadata: params.metadata,
            allow_promotion_codes: params.allow_promotion_codes,
            subscription_data: params.trial_period_days
              ? { trial_period_days: params.trial_period_days }
              : undefined,
            payment_method_types:
              params.payment_method_types as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
            expires_at: params.expires_at,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(session);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_checkout_session",
    {
      title: "Retrieve Checkout Session",
      description:
        "Retrieve a Checkout session by ID. Includes payment status and customer details.",
      inputSchema: {
        session_id: stripeIdSchema("cs_").describe("Checkout session ID (cs_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ session_id }) => {
      try {
        const session = await stripe.checkout.sessions.retrieve(session_id, {
          expand: ["line_items", "payment_intent"],
        });
        return stripeSuccessResult(session);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_checkout_sessions",
    {
      title: "List Checkout Sessions",
      description: "List Checkout sessions with optional filtering.",
      inputSchema: {
        customer: stripeIdSchema("cus_").optional().describe("Filter by customer ID"),
        payment_intent: stripeIdSchema("pi_").optional().describe("Filter by PaymentIntent ID"),
        subscription: stripeIdSchema("sub_").optional().describe("Filter by Subscription ID"),
        status: z.enum(["open", "complete", "expired"]).optional().describe("Filter by session status"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("cs_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const sessions = await stripe.checkout.sessions.list({
          customer: params.customer,
          payment_intent: params.payment_intent,
          subscription: params.subscription,
          status: params.status,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(sessions);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "create_coupon",
    {
      title: "Create Coupon",
      description: "Create a Stripe coupon for discounts on subscriptions or invoices.",
      inputSchema: createCouponSchema,
    },
    async (params) => {
      try {
        const coupon = await stripe.coupons.create(
          {
            percent_off: params.percent_off,
            amount_off: params.amount_off,
            currency: params.currency,
            duration: params.duration,
            duration_in_months: params.duration_in_months,
            name: params.name,
            max_redemptions: params.max_redemptions,
            redeem_by: params.redeem_by,
            metadata: params.metadata,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(coupon);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_coupons",
    {
      title: "List Coupons",
      description: "List all coupons.",
      inputSchema: {
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: z.string().optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const coupons = await stripe.coupons.list({
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(coupons);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
