/**
 * Invoice tools - Create, manage, and finalize Stripe invoices.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stripe } from "../stripe-client.js";
import {
  buildStripeRequestOptions,
  currencySchema,
  idempotencyKeySchema,
  stripeErrorResult,
  stripeIdSchema,
  stripeSuccessResult,
} from "../utils/stripe-toolkit.js";

export const createInvoiceSchema = z
  .object({
    customer: stripeIdSchema("cus_").describe("Customer ID (cus_...)"),
    collection_method: z
      .enum(["charge_automatically", "send_invoice"])
      .optional()
      .describe("Payment collection method"),
    days_until_due: z.number().int().positive().optional().describe("Days until due (for send_invoice)"),
    description: z.string().optional().describe("Invoice description"),
    metadata: z.record(z.string(), z.string()).optional().describe("Metadata"),
    auto_advance: z.boolean().optional().describe("Auto-finalize when ready (default true)"),
    idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
  })
  .superRefine((value, ctx) => {
    if (value.days_until_due !== undefined && value.collection_method !== "send_invoice") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'days_until_due requires collection_method="send_invoice".',
        path: ["days_until_due"],
      });
    }
  });

export const createInvoiceItemSchema = z
  .object({
    customer: stripeIdSchema("cus_").describe("Customer ID (cus_...)"),
    invoice: stripeIdSchema("in_")
      .optional()
      .describe("Invoice ID (in_...). Omit to add to next upcoming invoice."),
    pricing_price: stripeIdSchema("price_")
      .optional()
      .describe("Price ID (price_...) - use this OR amount+currency"),
    amount: z
      .number()
      .int()
      .optional()
      .describe("Amount in smallest currency unit (use with currency, not price)"),
    currency: currencySchema.optional().describe("Currency code (use with amount)"),
    description: z.string().optional().describe("Line item description"),
    quantity: z.number().int().positive().optional().describe("Quantity"),
    metadata: z.record(z.string(), z.string()).optional().describe("Metadata"),
    idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
  })
  .superRefine((value, ctx) => {
    const hasPrice = value.pricing_price !== undefined;
    const hasAmountCurrency = value.amount !== undefined || value.currency !== undefined;

    if (hasPrice && hasAmountCurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either pricing_price or amount+currency, not both.",
        path: ["pricing_price"],
      });
    }

    if (!hasPrice && !(value.amount !== undefined && value.currency !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide pricing_price or both amount and currency.",
        path: ["amount"],
      });
    }
  });

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool(
    "create_invoice",
    {
      title: "Create Invoice",
      description:
        "Create a draft invoice for a customer. Add invoice items before finalizing.",
      inputSchema: createInvoiceSchema,
    },
    async (params) => {
      try {
        const invoice = await stripe.invoices.create(
          {
            customer: params.customer,
            collection_method: params.collection_method,
            days_until_due: params.days_until_due,
            description: params.description,
            metadata: params.metadata,
            auto_advance: params.auto_advance,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(invoice);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "create_invoice_item",
    {
      title: "Create Invoice Item",
      description:
        "Add a line item to an invoice (or to the customer's next upcoming invoice).",
      annotations: { destructiveHint: true },
      inputSchema: createInvoiceItemSchema,
    },
    async (params) => {
      try {
        const item = await stripe.invoiceItems.create(
          {
            customer: params.customer,
            invoice: params.invoice,
            pricing: params.pricing_price ? { price: params.pricing_price } : undefined,
            amount: params.amount,
            currency: params.currency,
            description: params.description,
            quantity: params.quantity,
            metadata: params.metadata,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(item);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_invoice",
    {
      title: "Retrieve Invoice",
      description: "Retrieve an invoice by ID.",
      inputSchema: {
        invoice_id: stripeIdSchema("in_").describe("Invoice ID (in_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ invoice_id }) => {
      try {
        const invoice = await stripe.invoices.retrieve(invoice_id);
        return stripeSuccessResult(invoice);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "finalize_invoice",
    {
      title: "Finalize Invoice",
      description:
        "Finalize a draft invoice so it can be paid. This transitions it from draft to open.",
      annotations: { destructiveHint: true },
      inputSchema: {
        invoice_id: stripeIdSchema("in_").describe("Invoice ID (in_...)"),
        auto_advance: z.boolean().optional().describe("Auto-advance to payment after finalization"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
    },
    async ({ invoice_id, auto_advance, idempotency_key }) => {
      try {
        const invoice = await stripe.invoices.finalizeInvoice(
          invoice_id,
          { auto_advance },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(invoice);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "pay_invoice",
    {
      title: "Pay Invoice",
      description: "Attempt to pay an open invoice using the default payment method.",
      annotations: { destructiveHint: true },
      inputSchema: {
        invoice_id: stripeIdSchema("in_").describe("Invoice ID (in_...)"),
        payment_method: stripeIdSchema("pm_").optional().describe("Specific payment method to use"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
    },
    async ({ invoice_id, payment_method, idempotency_key }) => {
      try {
        const invoice = await stripe.invoices.pay(
          invoice_id,
          { payment_method },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(invoice);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "void_invoice",
    {
      title: "Void Invoice",
      description: "Void a finalized invoice. Cannot be undone.",
      inputSchema: {
        invoice_id: stripeIdSchema("in_").describe("Invoice ID (in_...)"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ invoice_id, idempotency_key }) => {
      try {
        const invoice = await stripe.invoices.voidInvoice(
          invoice_id,
          {},
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(invoice);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List Invoices",
      description: "List invoices with optional filtering.",
      inputSchema: {
        customer: stripeIdSchema("cus_").optional().describe("Filter by customer ID"),
        subscription: stripeIdSchema("sub_").optional().describe("Filter by subscription ID"),
        status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).optional().describe("Filter by status"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("in_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const invoices = await stripe.invoices.list({
          customer: params.customer,
          subscription: params.subscription,
          status: params.status,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(invoices);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_upcoming_invoice",
    {
      title: "Retrieve Upcoming Invoice",
      description:
        "Preview the next upcoming invoice for a customer. Useful for showing what will be charged.",
      inputSchema: {
        customer: stripeIdSchema("cus_").describe("Customer ID (cus_...)"),
        subscription: stripeIdSchema("sub_").optional().describe("Subscription ID to preview"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ customer, subscription }) => {
      try {
        const invoice = await stripe.invoices.createPreview({
          customer,
          subscription,
        });
        return stripeSuccessResult(invoice);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
