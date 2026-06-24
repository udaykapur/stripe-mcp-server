#!/usr/bin/env node
/**
 * Stripe MCP Server
 *
 * Provides tools, resources, and prompts for Stripe payment operations
 * including customers, payments, subscriptions, invoices, and more.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerPaymentTools } from "./tools/payments.js";
import { registerSubscriptionTools } from "./tools/subscriptions.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerRefundTools } from "./tools/refunds.js";
import { registerCheckoutTools } from "./tools/checkout.js";
import { registerBalanceTools } from "./tools/balance.js";
import { registerWebhookTools } from "./tools/webhooks.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";
import { StripeConfigError, getStripeClient } from "./stripe-client.js";

try {
  getStripeClient();
} catch (error) {
  if (error instanceof StripeConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const server = new McpServer({
  name: "stripe-mcp",
  version: "1.0.0",
});

registerCustomerTools(server);
registerPaymentTools(server);
registerSubscriptionTools(server);
registerInvoiceTools(server);
registerRefundTools(server);
registerCheckoutTools(server);
registerBalanceTools(server);
registerWebhookTools(server);
registerResources(server);
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
