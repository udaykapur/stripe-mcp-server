/**
 * Subscription tools - Subscriptions, Products, and Prices.
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

const subscriptionItemSchema = z.object({
  price: stripeIdSchema("price_").describe("Price ID (price_...)"),
  quantity: z.number().int().positive().optional().describe("Quantity (default 1)"),
});

export const createSubscriptionSchema = z
  .object({
    customer: stripeIdSchema("cus_").describe("Customer ID (cus_...)"),
    items: z.array(subscriptionItemSchema).min(1).describe("Subscription line items"),
    default_payment_method: stripeIdSchema("pm_").optional().describe("Payment method ID to use"),
    trial_period_days: z.number().int().min(1).optional().describe("Free trial days"),
    cancel_at_period_end: z.boolean().optional().describe("Cancel at end of current period"),
    metadata: z.record(z.string(), z.string()).optional().describe("Metadata key-value pairs"),
    collection_method: z
      .enum(["charge_automatically", "send_invoice"])
      .optional()
      .describe("How to collect payment"),
    days_until_due: z.number().int().positive().optional().describe("Days until invoice is due (for send_invoice)"),
    coupon: z.string().optional().describe("Coupon ID to apply"),
    promotion_code: z.string().optional().describe("Promotion code ID to apply"),
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

export function registerSubscriptionTools(server: McpServer): void {
  server.registerTool(
    "create_subscription",
    {
      title: "Create Subscription",
      description:
        "Create a new subscription for a customer. Requires at least one price item.",
      inputSchema: createSubscriptionSchema,
    },
    async (params) => {
      try {
        const sub = await stripe.subscriptions.create(
          {
            customer: params.customer,
            items: params.items,
            default_payment_method: params.default_payment_method,
            trial_period_days: params.trial_period_days,
            cancel_at_period_end: params.cancel_at_period_end,
            metadata: params.metadata,
            collection_method: params.collection_method,
            days_until_due: params.days_until_due,
            coupon: params.coupon,
            promotion_code: params.promotion_code,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(sub);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_subscription",
    {
      title: "Retrieve Subscription",
      description: "Retrieve a subscription by ID.",
      inputSchema: {
        subscription_id: stripeIdSchema("sub_").describe("Subscription ID (sub_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ subscription_id }) => {
      try {
        const sub = await stripe.subscriptions.retrieve(subscription_id);
        return stripeSuccessResult(sub);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "update_subscription",
    {
      title: "Update Subscription",
      description:
        "Update a subscription. Can change items, payment method, trial, cancellation behavior, and metadata.",
      inputSchema: {
        subscription_id: stripeIdSchema("sub_").describe("Subscription ID (sub_...)"),
        items: z
          .array(
            z.object({
              id: stripeIdSchema("si_").optional().describe("Existing subscription item ID to update (si_...)"),
              price: stripeIdSchema("price_").optional().describe("New price ID"),
              quantity: z.number().int().positive().optional().describe("New quantity"),
              deleted: z.boolean().optional().describe("Set true to remove this item"),
            }),
          )
          .optional()
          .describe("Updated line items"),
        cancel_at_period_end: z.boolean().optional().describe("Cancel at end of period"),
        default_payment_method: stripeIdSchema("pm_").optional().describe("New default payment method"),
        metadata: z.record(z.string(), z.string()).optional().describe("Metadata to update"),
        proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("How to handle prorations"),
        trial_end: z.union([z.number().int(), z.literal("now")]).optional().describe('Trial end timestamp or "now" to end immediately'),
        coupon: z.string().optional().describe("Coupon ID to apply"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
    },
    async ({ subscription_id, idempotency_key, ...params }) => {
      try {
        const sub = await stripe.subscriptions.update(
          subscription_id,
          {
            items: params.items,
            cancel_at_period_end: params.cancel_at_period_end,
            default_payment_method: params.default_payment_method,
            metadata: params.metadata,
            proration_behavior: params.proration_behavior,
            trial_end: params.trial_end,
            coupon: params.coupon,
          },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(sub);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "cancel_subscription",
    {
      title: "Cancel Subscription",
      description:
        "Cancel a subscription immediately or at the end of the current period.",
      inputSchema: {
        subscription_id: stripeIdSchema("sub_").describe("Subscription ID (sub_...)"),
        cancel_at_period_end: z.boolean().optional().describe("If true, cancel at period end instead of immediately (default: immediate)"),
        cancellation_details: z
          .object({
            comment: z.string().optional().describe("Internal cancellation note"),
            feedback: z
              .enum(["customer_service", "low_quality", "missing_features", "other", "switched_service", "too_complex", "too_expensive", "unused"])
              .optional()
              .describe("Cancellation reason"),
          })
          .optional()
          .describe("Cancellation details"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ subscription_id, cancel_at_period_end, cancellation_details, idempotency_key }) => {
      try {
        if (cancel_at_period_end) {
          const sub = await stripe.subscriptions.update(
            subscription_id,
            {
              cancel_at_period_end: true,
              cancellation_details,
            },
            buildStripeRequestOptions(idempotency_key),
          );
          return stripeSuccessResult(sub);
        }

        const sub = await stripe.subscriptions.cancel(
          subscription_id,
          { cancellation_details },
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(sub);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_subscriptions",
    {
      title: "List Subscriptions",
      description: "List subscriptions with optional filtering.",
      inputSchema: {
        customer: stripeIdSchema("cus_").optional().describe("Filter by customer ID"),
        price: stripeIdSchema("price_").optional().describe("Filter by price ID"),
        status: z.enum(["active", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "trialing", "all"]).optional().describe("Filter by status"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("sub_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const subs = await stripe.subscriptions.list({
          customer: params.customer,
          price: params.price,
          status: params.status,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(subs);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "create_product",
    {
      title: "Create Product",
      description: "Create a new Stripe product.",
      inputSchema: {
        name: z.string().min(1).describe("Product name"),
        description: z.string().optional().describe("Product description"),
        active: z.boolean().optional().describe("Whether the product is active (default true)"),
        metadata: z.record(z.string(), z.string()).optional().describe("Metadata"),
        default_price_data: z
          .object({
            unit_amount: z.number().int().positive().describe("Price in smallest currency unit"),
            currency: currencySchema.describe('Currency code (e.g. "usd")'),
            recurring: z
              .object({
                interval: z.enum(["day", "week", "month", "year"]).describe("Billing interval"),
                interval_count: z.number().int().positive().optional().describe("Number of intervals between billings"),
              })
              .optional()
              .describe("Recurring billing config (omit for one-time)"),
          })
          .optional()
          .describe("Inline price creation"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
    },
    async (params) => {
      try {
        const product = await stripe.products.create(
          {
            name: params.name,
            description: params.description,
            active: params.active,
            metadata: params.metadata,
            default_price_data: params.default_price_data,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(product);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_products",
    {
      title: "List Products",
      description: "List Stripe products.",
      inputSchema: {
        active: z.boolean().optional().describe("Filter by active status"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("prod_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const products = await stripe.products.list({
          active: params.active,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(products);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "create_price",
    {
      title: "Create Price",
      description: "Create a new price for a product.",
      inputSchema: {
        product: stripeIdSchema("prod_").describe("Product ID (prod_...)"),
        unit_amount: z.number().int().positive().describe("Price in smallest currency unit (e.g. 1000 = $10.00)"),
        currency: currencySchema.describe('Currency code (e.g. "usd")'),
        recurring: z
          .object({
            interval: z.enum(["day", "week", "month", "year"]).describe("Billing interval"),
            interval_count: z.number().int().positive().optional().describe("Intervals between billings"),
            trial_period_days: z.number().int().positive().optional().describe("Trial days"),
          })
          .optional()
          .describe("Recurring config (omit for one-time price)"),
        active: z.boolean().optional().describe("Whether price is active"),
        metadata: z.record(z.string(), z.string()).optional().describe("Metadata"),
        nickname: z.string().optional().describe("Internal nickname"),
        idempotency_key: idempotencyKeySchema.optional().describe("Optional idempotency key for safe retries"),
      },
    },
    async (params) => {
      try {
        const price = await stripe.prices.create(
          {
            product: params.product,
            unit_amount: params.unit_amount,
            currency: params.currency,
            recurring: params.recurring,
            active: params.active,
            metadata: params.metadata,
            nickname: params.nickname,
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(price);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_prices",
    {
      title: "List Prices",
      description: "List prices with optional product filter.",
      inputSchema: {
        product: stripeIdSchema("prod_").optional().describe("Filter by product ID"),
        active: z.boolean().optional().describe("Filter by active status"),
        type: z.enum(["one_time", "recurring"]).optional().describe("Filter by type"),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("price_").optional().describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const prices = await stripe.prices.list({
          product: params.product,
          active: params.active,
          type: params.type,
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });
        return stripeSuccessResult(prices);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
