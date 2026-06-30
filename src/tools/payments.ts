/**
 * Payment tools - Payment Intents, Payment Methods, and Charges.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Stripe from "stripe";
import { z } from "zod";
import { stripe } from "../stripe-client.js";
import {
  buildStripeRequestOptions,
  currencySchema,
  httpsUrlSchema,
  idempotencyKeySchema,
  paymentMethodTypeSchema,
  stripeErrorResult,
  stripeIdSchema,
  stripeSuccessResult,
} from "../utils/stripe-toolkit.js";

const createPaymentIntentSchema = z.object({
  amount: z
    .number()
    .int()
    .positive()
    .describe("Amount in smallest currency unit (e.g. 1000 = $10.00)"),
  currency: currencySchema.describe('Three-letter ISO currency code (e.g. "usd", "eur")'),
  customer: stripeIdSchema("cus_").optional().describe("Customer ID to associate"),
  description: z.string().optional().describe("Payment description"),
  payment_method: stripeIdSchema("pm_").optional().describe("Payment method ID to use"),
  confirm: z.boolean().optional().describe("Immediately confirm the payment (default false)"),
  automatic_payment_methods: z
    .boolean()
    .optional()
    .describe("Enable automatic payment methods (default true)"),
  metadata: z.record(z.string(), z.string()).optional().describe("Metadata key-value pairs"),
  receipt_email: z.string().email().optional().describe("Email to send receipt to"),
  statement_descriptor: z.string().max(22).optional().describe("Statement descriptor (max 22 chars)"),
  capture_method: z
    .enum(["automatic", "automatic_async", "manual"])
    .optional()
    .describe('"automatic" (default), "automatic_async", or "manual" for auth-then-capture'),
  off_session: z.boolean().optional().describe("Set true if payment is made without customer present"),
  idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
});

export function registerPaymentTools(server: McpServer): void {
  server.registerTool(
    "create_payment_intent",
    {
      title: "Create Payment Intent",
      description:
        "Create a Stripe PaymentIntent. Amount is in the smallest currency unit (e.g. cents for USD).",
      annotations: { destructiveHint: true },
      inputSchema: createPaymentIntentSchema,
    },
    async (params) => {
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount: params.amount,
            currency: params.currency,
            customer: params.customer,
            description: params.description,
            payment_method: params.payment_method,
            confirm: params.confirm,
            automatic_payment_methods:
              params.automatic_payment_methods === false
                ? { enabled: false }
                : { enabled: true },
            metadata: params.metadata,
            receipt_email: params.receipt_email,
            statement_descriptor: params.statement_descriptor,
            capture_method: params.capture_method,
            off_session: params.off_session,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(pi);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_payment_intent",
    {
      title: "Retrieve Payment Intent",
      description: "Retrieve a PaymentIntent by ID.",
      inputSchema: {
        payment_intent_id: stripeIdSchema("pi_").describe("PaymentIntent ID (pi_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ payment_intent_id }) => {
      try {
        const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
        return stripeSuccessResult(pi);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "confirm_payment_intent",
    {
      title: "Confirm Payment Intent",
      description:
        "Confirm a PaymentIntent to initiate the payment. Optionally attach a payment method.",
      annotations: { destructiveHint: true },
      inputSchema: {
        payment_intent_id: stripeIdSchema("pi_").describe("PaymentIntent ID (pi_...)"),
        payment_method: stripeIdSchema("pm_")
          .optional()
          .describe("Payment method ID to use for confirmation"),
        return_url: httpsUrlSchema
          .optional()
          .describe("Return URL for redirect-based payment methods"),
        idempotency_key: idempotencyKeySchema
          .optional()
          .describe("Optional idempotency key for safe retries"),
      },
    },
    async ({ payment_intent_id, payment_method, return_url, idempotency_key }) => {
      try {
        const pi = await stripe.paymentIntents.confirm(
          payment_intent_id,
          {
            payment_method,
            return_url,
          },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(pi);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "capture_payment_intent",
    {
      title: "Capture Payment Intent",
      description:
        "Capture a previously authorized PaymentIntent (capture_method=manual). Optionally capture a partial amount.",
      annotations: { destructiveHint: true },
      inputSchema: {
        payment_intent_id: stripeIdSchema("pi_").describe("PaymentIntent ID (pi_...)"),
        amount_to_capture: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Amount to capture in smallest currency unit. Omit to capture full authorization.",
          ),
        idempotency_key: idempotencyKeySchema
          .optional()
          .describe("Optional idempotency key for safe retries"),
      },
    },
    async ({ payment_intent_id, amount_to_capture, idempotency_key }) => {
      try {
        const pi = await stripe.paymentIntents.capture(
          payment_intent_id,
          {
            amount_to_capture,
          },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(pi);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "cancel_payment_intent",
    {
      title: "Cancel Payment Intent",
      description: "Cancel a PaymentIntent. Can only cancel intents that are not already succeeded.",
      inputSchema: {
        payment_intent_id: stripeIdSchema("pi_").describe("PaymentIntent ID (pi_...)"),
        cancellation_reason: z
          .enum(["duplicate", "fraudulent", "requested_by_customer", "abandoned"])
          .optional()
          .describe("Reason for cancellation"),
        idempotency_key: idempotencyKeySchema
          .optional()
          .describe("Optional idempotency key for safe retries"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ payment_intent_id, cancellation_reason, idempotency_key }) => {
      try {
        const pi = await stripe.paymentIntents.cancel(
          payment_intent_id,
          {
            cancellation_reason,
          },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(pi);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_payment_intents",
    {
      title: "List Payment Intents",
      description: "List PaymentIntents with optional filtering.",
      inputSchema: {
        customer: stripeIdSchema("cus_").optional().describe("Filter by customer ID"),
        limit: z.number().min(1).max(100).optional().describe("Results per page (1-100)"),
        starting_after: stripeIdSchema("pi_").optional().describe("Pagination cursor"),
        created_gte: z.number().int().optional().describe("Created at or after (Unix timestamp)"),
        created_lte: z.number().int().optional().describe("Created at or before (Unix timestamp)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const listParams: Record<string, unknown> = {
          limit: params.limit ?? 10,
        };
        if (params.customer) listParams.customer = params.customer;
        if (params.starting_after) listParams.starting_after = params.starting_after;
        if (params.created_gte || params.created_lte) {
          const created: Record<string, number> = {};
          if (params.created_gte) created.gte = params.created_gte;
          if (params.created_lte) created.lte = params.created_lte;
          listParams.created = created;
        }

        const pis = await stripe.paymentIntents.list(listParams);
        return stripeSuccessResult(pis);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_payment_methods",
    {
      title: "List Payment Methods",
      description: "List payment methods attached to a customer.",
      inputSchema: {
        customer: stripeIdSchema("cus_").describe("Customer ID (cus_...)"),
        type: paymentMethodTypeSchema
          .optional()
          .describe("Filter by payment method type (e.g. card, us_bank_account, paypal)"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ customer, type, limit }) => {
      try {
        const pms = await stripe.paymentMethods.list({
          customer,
          type: type as Stripe.PaymentMethodListParams.Type | undefined,
          limit: limit ?? 10,
        });
        return stripeSuccessResult(pms);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "attach_payment_method",
    {
      title: "Attach Payment Method",
      description: "Attach a payment method to a customer.",
      inputSchema: {
        payment_method_id: stripeIdSchema("pm_").describe("Payment method ID (pm_...)"),
        customer: stripeIdSchema("cus_").describe("Customer ID to attach to (cus_...)"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
    },
    async ({ payment_method_id, customer, idempotency_key }) => {
      try {
        const pm = await stripe.paymentMethods.attach(
          payment_method_id,
          { customer },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(pm);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "detach_payment_method",
    {
      title: "Detach Payment Method",
      description: "Detach a payment method from its customer.",
      inputSchema: {
        payment_method_id: stripeIdSchema("pm_").describe("Payment method ID (pm_...)"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ payment_method_id, idempotency_key }) => {
      try {
        const pm = await stripe.paymentMethods.detach(
          payment_method_id,
          {},
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(pm);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_charge",
    {
      title: "Retrieve Charge",
      description: "Retrieve a charge by ID.",
      inputSchema: {
        charge_id: stripeIdSchema("ch_").describe("Charge ID (ch_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ charge_id }) => {
      try {
        const charge = await stripe.charges.retrieve(charge_id);
        return stripeSuccessResult(charge);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_charges",
    {
      title: "List Charges",
      description: "List charges with optional filtering.",
      inputSchema: {
        customer: stripeIdSchema("cus_").optional().describe("Filter by customer ID"),
        payment_intent: stripeIdSchema("pi_")
          .optional()
          .describe("Filter by PaymentIntent ID"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("ch_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const charges = await stripe.charges.list({
          customer: params.customer,
          payment_intent: params.payment_intent,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(charges);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
