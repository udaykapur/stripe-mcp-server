/**
 * Balance tools - Retrieve account balance and list balance transactions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stripe } from "../stripe-client.js";
import {
  balanceTransactionTypeSchema,
  stripeErrorResult,
  stripeIdSchema,
  stripeLikeIdSchema,
  stripeSuccessResult,
} from "../utils/stripe-toolkit.js";

export function registerBalanceTools(server: McpServer): void {
  server.registerTool(
    "retrieve_balance",
    {
      title: "Retrieve Balance",
      description:
        "Retrieve the current Stripe account balance, broken down by currency and status (available, pending).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const balance = await stripe.balance.retrieve();
        return stripeSuccessResult(balance);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_balance_transactions",
    {
      title: "List Balance Transactions",
      description:
        "List balance transactions (charges, refunds, payouts, fees, etc.) with optional filtering.",
      inputSchema: {
        type: balanceTransactionTypeSchema
          .optional()
          .describe('Filter by transaction type: "charge", "refund", "payout", "adjustment", "transfer", etc.'),
        payout: stripeIdSchema("po_").optional().describe("Filter by payout ID"),
        source: stripeLikeIdSchema.optional().describe("Filter by source ID (charge, refund, etc.)"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("txn_").optional().describe("Pagination cursor"),
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
        if (params.type) listParams.type = params.type;
        if (params.payout) listParams.payout = params.payout;
        if (params.source) listParams.source = params.source;
        if (params.starting_after) listParams.starting_after = params.starting_after;
        if (params.created_gte || params.created_lte) {
          const created: Record<string, number> = {};
          if (params.created_gte) created.gte = params.created_gte;
          if (params.created_lte) created.lte = params.created_lte;
          listParams.created = created;
        }

        const txns = await stripe.balanceTransactions.list(listParams);
        return stripeSuccessResult(txns);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_payouts",
    {
      title: "List Payouts",
      description: "List payouts to your bank account or debit card.",
      inputSchema: {
        status: z.enum(["pending", "paid", "failed", "canceled"]).optional().describe("Filter by payout status"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("po_").optional().describe("Pagination cursor"),
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
        if (params.status) listParams.status = params.status;
        if (params.starting_after) listParams.starting_after = params.starting_after;
        if (params.created_gte || params.created_lte) {
          const created: Record<string, number> = {};
          if (params.created_gte) created.gte = params.created_gte;
          if (params.created_lte) created.lte = params.created_lte;
          listParams.created = created;
        }

        const payouts = await stripe.payouts.list(listParams);
        return stripeSuccessResult(payouts);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_disputes",
    {
      title: "List Disputes",
      description: "List payment disputes (chargebacks).",
      inputSchema: {
        charge: stripeIdSchema("ch_").optional().describe("Filter by charge ID"),
        payment_intent: stripeIdSchema("pi_").optional().describe("Filter by PaymentIntent ID"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("dp_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const disputes = await stripe.disputes.list({
          charge: params.charge,
          payment_intent: params.payment_intent,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(disputes);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_dispute",
    {
      title: "Retrieve Dispute",
      description: "Retrieve a dispute by ID with full details.",
      inputSchema: {
        dispute_id: stripeIdSchema("dp_").describe("Dispute ID (dp_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ dispute_id }) => {
      try {
        const dispute = await stripe.disputes.retrieve(dispute_id);
        return stripeSuccessResult(dispute);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
