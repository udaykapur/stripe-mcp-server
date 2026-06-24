/**
 * Customer tools - CRUD operations on Stripe customers.
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

const createCustomerSchema = z.object({
  email: z.string().email().optional().describe("Customer email address"),
  name: z.string().optional().describe("Customer full name"),
  phone: z.string().optional().describe("Customer phone number"),
  description: z.string().optional().describe("Internal description"),
  metadata: z
    .record(z.string(), z.string())
    .optional()
    .describe("Key-value metadata pairs"),
  payment_method: stripeIdSchema("pm_")
    .optional()
    .describe("Payment method ID to attach"),
  idempotency_key: idempotencyKeySchema
    .optional()
    .describe("Optional idempotency key for safe retries"),
});

const updateCustomerSchema = z.object({
  customer_id: stripeIdSchema("cus_").describe("Stripe customer ID (cus_...)"),
  email: z.string().email().optional().describe("New email address"),
  name: z.string().optional().describe("New name"),
  phone: z.string().optional().describe("New phone number"),
  description: z.string().optional().describe("New description"),
  metadata: z
    .record(z.string(), z.string())
    .optional()
    .describe("Metadata to merge (set value to empty string to remove a key)"),
  default_payment_method: stripeIdSchema("pm_")
    .optional()
    .describe("Default payment method ID for invoices"),
  idempotency_key: idempotencyKeySchema
    .optional()
    .describe("Optional idempotency key for safe retries"),
});

export function registerCustomerTools(server: McpServer): void {
  server.registerTool(
    "create_customer",
    {
      title: "Create Customer",
      description:
        "Create a new Stripe customer with optional email, name, phone, description, and metadata.",
      inputSchema: createCustomerSchema,
    },
    async (params) => {
      try {
        const customer = await stripe.customers.create(
          {
            email: params.email,
            name: params.name,
            phone: params.phone,
            description: params.description,
            metadata: params.metadata,
            payment_method: params.payment_method,
            ...(params.payment_method
              ? {
                  invoice_settings: {
                    default_payment_method: params.payment_method,
                  },
                }
              : {}),
          },
          buildStripeRequestOptions(params.idempotency_key),
        );
        return stripeSuccessResult(customer);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_customer",
    {
      title: "Retrieve Customer",
      description: "Retrieve a Stripe customer by ID.",
      inputSchema: {
        customer_id: stripeIdSchema("cus_").describe("Stripe customer ID (cus_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ customer_id }) => {
      try {
        const customer = await stripe.customers.retrieve(customer_id);
        return stripeSuccessResult(customer);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "update_customer",
    {
      title: "Update Customer",
      description: "Update an existing Stripe customer's details.",
      inputSchema: updateCustomerSchema,
    },
    async ({ customer_id, idempotency_key, ...params }) => {
      try {
        const updateData: Record<string, unknown> = {};
        if (params.email !== undefined) updateData.email = params.email;
        if (params.name !== undefined) updateData.name = params.name;
        if (params.phone !== undefined) updateData.phone = params.phone;
        if (params.description !== undefined) updateData.description = params.description;
        if (params.metadata !== undefined) updateData.metadata = params.metadata;
        if (params.default_payment_method !== undefined) {
          updateData.invoice_settings = {
            default_payment_method: params.default_payment_method,
          };
        }

        const customer = await stripe.customers.update(
          customer_id,
          updateData,
          buildStripeRequestOptions(idempotency_key),
        );
        return stripeSuccessResult(customer);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "delete_customer",
    {
      title: "Delete Customer",
      description:
        "Permanently delete a Stripe customer. This cannot be undone. Active subscriptions will be canceled.",
      inputSchema: {
        customer_id: stripeIdSchema("cus_").describe("Stripe customer ID (cus_...)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ customer_id }) => {
      try {
        const result = await stripe.customers.del(customer_id);
        return stripeSuccessResult(result);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_customers",
    {
      title: "List Customers",
      description:
        "List Stripe customers with optional filtering by email, creation date, and pagination.",
      inputSchema: {
        email: z.string().email().optional().describe("Filter by exact email address"),
        limit: z.number().min(1).max(100).optional().describe("Number of results (1-100, default 10)"),
        starting_after: stripeIdSchema("cus_")
          .optional()
          .describe("Cursor for pagination - customer ID to start after"),
        created_gte: z.number().int().optional().describe("Filter: created at or after this Unix timestamp"),
        created_lte: z.number().int().optional().describe("Filter: created at or before this Unix timestamp"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const listParams: Record<string, unknown> = {
          limit: params.limit ?? 10,
        };
        if (params.email) listParams.email = params.email;
        if (params.starting_after) listParams.starting_after = params.starting_after;
        if (params.created_gte || params.created_lte) {
          const created: Record<string, number> = {};
          if (params.created_gte) created.gte = params.created_gte;
          if (params.created_lte) created.lte = params.created_lte;
          listParams.created = created;
        }

        const customers = await stripe.customers.list(listParams);
        return stripeSuccessResult(customers);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "search_customers",
    {
      title: "Search Customers",
      description:
        'Search Stripe customers using the Search API. Query syntax: field~"value" or field:"value". Searchable fields: email, name, phone, metadata.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Stripe search query, e.g. \'email~"test"\' or \'name:"John Doe"\' or \'metadata["key"]:"value"\'',
          ),
        limit: z.number().min(1).max(100).optional().describe("Max results (1-100)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      try {
        const results = await stripe.customers.search({
          query,
          limit: limit ?? 10,
        });
        return stripeSuccessResult(results);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
