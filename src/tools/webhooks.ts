/**
 * Webhook tools - Manage Stripe webhook endpoints and view events.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Stripe from "stripe";
import { stripe } from "../stripe-client.js";
import {
  buildStripeRequestOptions,
  httpsUrlSchema,
  idempotencyKeySchema,
  stripeErrorResult,
  stripeIdSchema,
  stripeSuccessResult,
  webhookApiVersionSchema,
  webhookEnabledEventSchema,
} from "../utils/stripe-toolkit.js";

export const createWebhookEndpointSchema = z.object({
  url: httpsUrlSchema.describe("HTTPS URL that will receive webhook events"),
  enabled_events: z
    .array(webhookEnabledEventSchema)
    .min(1)
    .describe(
      'Event types to listen for, e.g. ["payment_intent.succeeded", "customer.subscription.deleted"].',
    ),
  description: z.string().optional().describe("Endpoint description"),
  metadata: z.record(z.string(), z.string()).optional().describe("Metadata"),
  api_version: webhookApiVersionSchema
    .optional()
    .describe("Stripe API version for events (defaults to account version)"),
  idempotency_key: idempotencyKeySchema
    .optional()
    .describe("Optional idempotency key for safe retries"),
});

export function registerWebhookTools(server: McpServer): void {
  server.registerTool(
    "create_webhook_endpoint",
    {
      title: "Create Webhook Endpoint",
      description: "Register a new webhook endpoint with Stripe.",
      annotations: { destructiveHint: true },
      inputSchema: createWebhookEndpointSchema,
    },
    async (params) => {
      try {
        const endpoint = await stripe.webhookEndpoints.create(
          {
            url: params.url,
            enabled_events:
              params.enabled_events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
            description: params.description,
            metadata: params.metadata,
            api_version: params.api_version as Parameters<
              typeof stripe.webhookEndpoints.create
            >[0]["api_version"],
          },
          buildStripeRequestOptions(params.idempotency_key),
        );

        return stripeSuccessResult(endpoint, [
          "Stripe webhook signing secrets are intentionally redacted by this MCP server. Store them through a separate secure provisioning path.",
        ]);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_webhook_endpoints",
    {
      title: "List Webhook Endpoints",
      description: "List all registered webhook endpoints.",
      inputSchema: {
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("we_")
          .optional()
          .describe("Pagination cursor"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const endpoints = await stripe.webhookEndpoints.list({
          limit: params.limit ?? 10,
          starting_after: params.starting_after,
        });

        return stripeSuccessResult(endpoints);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "delete_webhook_endpoint",
    {
      title: "Delete Webhook Endpoint",
      description: "Delete a webhook endpoint. Cannot be undone.",
      inputSchema: {
        webhook_endpoint_id: stripeIdSchema("we_").describe(
          "Webhook endpoint ID (we_...)",
        ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ webhook_endpoint_id }) => {
      try {
        const result = await stripe.webhookEndpoints.del(webhook_endpoint_id);
        return stripeSuccessResult(result);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      title: "List Events",
      description:
        "List recent Stripe events (webhook deliveries). Useful for debugging integrations.",
      inputSchema: {
        type: webhookEnabledEventSchema
          .optional()
          .describe(
            'Filter by event type, e.g. "payment_intent.succeeded", "customer.created"',
          ),
        limit: z.number().min(1).max(100).optional().describe("Results per page"),
        starting_after: stripeIdSchema("evt_")
          .optional()
          .describe("Pagination cursor"),
        created_gte: z
          .number()
          .int()
          .optional()
          .describe("Created at or after (Unix timestamp)"),
        created_lte: z
          .number()
          .int()
          .optional()
          .describe("Created at or before (Unix timestamp)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const listParams: Record<string, unknown> = {
          limit: params.limit ?? 10,
        };
        if (params.type) listParams.type = params.type;
        if (params.starting_after) {
          listParams.starting_after = params.starting_after;
        }
        if (params.created_gte || params.created_lte) {
          const created: Record<string, number> = {};
          if (params.created_gte) created.gte = params.created_gte;
          if (params.created_lte) created.lte = params.created_lte;
          listParams.created = created;
        }

        const events = await stripe.events.list(listParams);
        return stripeSuccessResult(events);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );

  server.registerTool(
    "retrieve_event",
    {
      title: "Retrieve Event",
      description: "Retrieve a single event by ID with full payload.",
      inputSchema: {
        event_id: stripeIdSchema("evt_").describe("Event ID (evt_...)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ event_id }) => {
      try {
        const event = await stripe.events.retrieve(event_id);
        return stripeSuccessResult(event);
      } catch (err) {
        return stripeErrorResult(err);
      }
    },
  );
}
