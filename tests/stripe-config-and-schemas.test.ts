import { describe, expect, it } from "vitest";
import {
  STRIPE_API_VERSION,
  StripeConfigError,
  getStripeClient,
  getStripeRuntimeConfig,
  resetStripeClientForTests,
} from "../src/stripe-client.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCheckoutSessionSchema, createCouponSchema, registerCheckoutTools } from "../src/tools/checkout.js";
import { createRefundSchema, registerRefundTools } from "../src/tools/refunds.js";
import { createWebhookEndpointSchema, registerWebhookTools } from "../src/tools/webhooks.js";
import { registerCustomerTools } from "../src/tools/customers.js";
import { registerPaymentTools } from "../src/tools/payments.js";
import { registerSubscriptionTools } from "../src/tools/subscriptions.js";
import { registerInvoiceTools } from "../src/tools/invoices.js";
import { registerBalanceTools } from "../src/tools/balance.js";

describe("stripe-client", () => {
  it("returns pinned runtime config", () => {
    expect(
      getStripeRuntimeConfig({
        STRIPE_SECRET_KEY: "sk_test_123",
      }),
    ).toEqual({
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 30000,
    });
  });

  it("throws a typed error when the secret key is missing", () => {
    resetStripeClientForTests();
    expect(() => getStripeClient({})).toThrow(StripeConfigError);
  });

  it("rejects pathological retry and timeout settings", () => {
    expect(() =>
      getStripeRuntimeConfig({
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_MAX_NETWORK_RETRIES: "9",
      }),
    ).toThrow(/between 0 and 5/);

    expect(() =>
      getStripeRuntimeConfig({
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_TIMEOUT_MS: "999999",
      }),
    ).toThrow(/between 1000 and 120000/);
  });
});

describe("schema hardening", () => {
  it("rejects wildcard webhook-like checkout misuse via URL validation and line item rules", () => {
    const result = createCheckoutSessionSchema.safeParse({
      mode: "payment",
      success_url: "http://example.com/success",
    });

    expect(result.success).toBe(false);
  });

  it("requires exactly one refund target", () => {
    const result = createRefundSchema.safeParse({
      payment_intent: "pi_123",
      charge: "ch_123",
    });

    expect(result.success).toBe(false);
  });

  it("enforces coupon field combinations", () => {
    const result = createCouponSchema.safeParse({
      duration: "repeating",
      percent_off: 20,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid checkout payment method types", () => {
    const result = createCheckoutSessionSchema.safeParse({
      mode: "payment",
      line_items: [{ price: "price_123", quantity: 1 }],
      success_url: "https://example.com/success",
      payment_method_types: ["not_real"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid webhook event names and API versions", () => {
    const result = createWebhookEndpointSchema.safeParse({
      url: "https://example.com/webhook",
      enabled_events: ["not.a.real.event"],
      api_version: "2099-01-01",
    });

    expect(result.success).toBe(false);
  });
});

describe("tool discovery (MCP listTools)", () => {
  it("serialises every tool input schema and exposes the key tools", async () => {
    process.env.STRIPE_SECRET_KEY ??= "sk_test_123";
    const server = new McpServer({ name: "stripe-mcp", version: "1.0.0" });
    registerCustomerTools(server);
    registerPaymentTools(server);
    registerSubscriptionTools(server);
    registerInvoiceTools(server);
    registerRefundTools(server);
    registerCheckoutTools(server);
    registerBalanceTools(server);
    registerWebhookTools(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // listTools serialises every input schema to JSON Schema. A z.undefined()
    // in a union throws "Undefined cannot be represented in JSON Schema" here,
    // so this guards every tool's schema, not just the ones below.
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    for (const expected of [
      "create_checkout_session",
      "list_balance_transactions",
      "create_webhook_endpoint",
      "list_events",
    ]) {
      expect(names).toContain(expected);
    }

    await client.close();
  });
});
