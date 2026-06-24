/**
 * Refund tools - Create and manage Stripe refunds.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stripe } from "../stripe-client.js";
import {
  buildStripeRequestOptions,
  idempotencyKeySchema,
  stripeErrorResult,
  stripeIdSchema,
  stripeSuccessResult,
} from "../utils/stripe-toolkit.js";

export const createRefundSchema = z
  .object({
    payment_intent: stripeIdSchema("pi_")
      .optional()
      .describe("PaymentIntent ID to refund (pi_...)"),
    charge: stripeIdSchema("ch_")
      .optional()
      .describe("Charge ID to refund (ch_...) - use this or payment_intent"),
    amount: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Amount to refund in smallest currency unit. Omit for full refund."),
    reason: z
      .enum(["duplicate", "fraudulent", "requested_by_customer"])
      .optional()
      .describe("Reason for refund"),
    metadata: z.record(z.string(), z.string()).optional().describe("Metadata"),
    idempotency_key: idempotencyKeySchema
      .optional()
      .describe("Optional idempotency key for safe retries"),
  })
  .superRefine((value, ctx) => {
    const provided = Number(Boolean(value.payment_intent)) + Number(Boolean(value.charge));
    if (provided !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of payment_intent or charge.",
        path: ["payment_intent"],
      });
    }
  });

export function registerRefundTools(server: McpServer): void {
  server.registerTool(
    "create_refund",
    {
      title: "Create Refund",
      description:
        "Refund a charge or payment intent. Specify amount for partial refunds; omit for full refund.",
      annotations: { destructiveHint: true },
      inputSchema: createRefundSchema,
    },
    async (params) => {
      try {
        const refund = await stripe.refunds.create(
          {
            payment_intent: params.payment_intent,
            charge: params.charge,
            amount: params.amount,
            reason: params.reason,
            metadata: params.metadata,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(refund);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_refund",
    {
      title: "Retrieve Refund",
      description: "Retrieve a refund by ID.",
      inputSchema: {
        refund_id: stripeIdSchema("re_").describe("Refund ID (re_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ refund_id }) => {
      try {
        const refund = await stripe.refunds.retrieve(refund_id);
        return stripeSuccessResult(refund);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_refunds",
    {
      title: "List Refunds",
      description: "List refunds with optional filtering.",
      inputSchema: {
        payment_intent: stripeIdSchema("pi_").optional().describe("Filter by PaymentIntent ID"),
        charge: stripeIdSchema("ch_").optional().describe("Filter by Charge ID"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("re_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const refunds = await stripe.refunds.list({
          payment_intent: params.payment_intent,
          charge: params.charge,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(refunds);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
