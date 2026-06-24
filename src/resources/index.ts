/**
 * Resources - Expose sanitized Stripe account info and configuration.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { stripe } from "../stripe-client.js";
import {
  formatStripeError,
  sanitizeStripeResponse,
} from "../utils/stripe-toolkit.js";

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(sanitizeStripeResponse(data), null, 2),
      },
    ],
  };
}

function errorResource(uri: string, prefix: string, error: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ error: `${prefix}:`, details: formatStripeError(error) }, null, 2),
      },
    ],
  };
}

export function registerResources(server: McpServer): void {
  server.registerResource(
    "account",
    "stripe://account",
    {
      description:
        "Current Stripe account details: business name, country, capabilities, and settings (sanitized).",
    },
    async () => {
      try {
        const account = await stripe.accounts.retrieve();
        return jsonResource("stripe://account", account);
      } catch (err) {
        return errorResource("stripe://account", "Error retrieving account", err);
      }
    },
  );

  server.registerResource(
    "balance",
    "stripe://balance",
    {
      description:
        "Current Stripe balance broken down by currency (available, pending, connect_reserved).",
    },
    async () => {
      try {
        const balance = await stripe.balance.retrieve();
        return jsonResource("stripe://balance", balance);
      } catch (err) {
        return errorResource("stripe://balance", "Error retrieving balance", err);
      }
    },
  );

  server.registerResource(
    "webhook_endpoints",
    "stripe://webhook-endpoints",
    {
      description:
        "List of registered webhook endpoints with enabled events and status (sanitized; secrets redacted).",
    },
    async () => {
      try {
        const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
        return jsonResource("stripe://webhook-endpoints", endpoints.data);
      } catch (err) {
        return errorResource("stripe://webhook-endpoints", "Error listing webhooks", err);
      }
    },
  );

  server.registerResource(
    "products_catalog",
    "stripe://products",
    {
      description: "Active product catalog with default prices (sanitized).",
    },
    async () => {
      try {
        const products = await stripe.products.list({
          active: true,
          limit: 100,
          expand: ["data.default_price"],
        });
        return jsonResource("stripe://products", products.data);
      } catch (err) {
        return errorResource("stripe://products", "Error listing products", err);
      }
    },
  );
}
