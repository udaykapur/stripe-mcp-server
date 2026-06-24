import { describe, expect, it } from "vitest";
import {
  formatStripeError,
  sanitizeStripeResponse,
} from "../src/utils/stripe-toolkit.js";

describe("sanitizeStripeResponse", () => {
  it("redacts webhook endpoint secrets", () => {
    const result = sanitizeStripeResponse({
      object: "webhook_endpoint",
      id: "we_123",
      url: "https://example.com/webhook",
      enabled_events: ["payment_intent.succeeded"],
      secret: "whsec_123",
    }) as Record<string, unknown>;

    expect(result.secret).toBeUndefined();
    expect(result.secret_redacted).toBe(true);
    expect(result.id).toBe("we_123");
  });

  it("removes payment intent client secrets and masks emails", () => {
    const result = sanitizeStripeResponse({
      object: "payment_intent",
      id: "pi_123",
      amount: 1000,
      currency: "usd",
      status: "requires_payment_method",
      receipt_email: "user@example.com",
      client_secret: "pi_secret_123",
    }) as Record<string, unknown>;

    expect(result.client_secret).toBeUndefined();
    expect(result.receipt_email).toBe("us**@example.com");
    expect(result.amount).toBe(1000);
  });

  it("masks customer PII", () => {
    const result = sanitizeStripeResponse({
      object: "customer",
      id: "cus_123",
      email: "customer@example.com",
      phone: "+15551234567",
      address: { city: "Melbourne" },
      invoice_settings: { default_payment_method: "pm_123", footer: "Footer" },
    }) as Record<string, unknown>;

    expect(result.email).toBe("cu******@example.com");
    expect(result.phone).toBe("***4567");
    expect(result.address).toBeUndefined();
    expect(result.invoice_settings).toEqual({
      default_payment_method: "pm_123",
      footer: "Footer",
    });
  });

  it("redacts metadata values while preserving metadata keys", () => {
    const result = sanitizeStripeResponse({
      object: "customer",
      id: "cus_123",
      metadata: {
        internal_note: "very-secret",
        crm_id: "12345",
      },
    }) as Record<string, unknown>;

    expect(result.metadata).toEqual({
      redacted: true,
      keys: ["crm_id", "internal_note"],
    });
  });

  it("redacts unknown Stripe object types by default", () => {
    const result = sanitizeStripeResponse({
      object: "issuing.card",
      id: "ic_123",
      livemode: false,
      number: "4242424242424242",
      metadata: { secret: "keep-out" },
    }) as Record<string, unknown>;

    expect(result).toEqual({
      object: "issuing.card",
      id: "ic_123",
      livemode: false,
      redacted: true,
    });
  });

  it("recursively sanitizes an expanded payment_intent on a checkout session", () => {
    const result = sanitizeStripeResponse({
      object: "checkout.session",
      id: "cs_123",
      payment_intent: {
        object: "payment_intent",
        id: "pi_123",
        client_secret: "pi_secret_123",
        amount: 500,
      },
    }) as Record<string, unknown>;

    const paymentIntent = result.payment_intent as Record<string, unknown>;
    expect(paymentIntent.id).toBe("pi_123");
    expect(paymentIntent.client_secret).toBeUndefined();
  });

  it("redacts metadata on an expanded product default_price", () => {
    const result = sanitizeStripeResponse({
      object: "product",
      id: "prod_123",
      default_price: {
        object: "price",
        id: "price_123",
        unit_amount: 4900,
        metadata: { internal: "secret" },
      },
    }) as Record<string, unknown>;

    const price = result.default_price as Record<string, unknown>;
    expect(price.id).toBe("price_123");
    expect(price.metadata).toEqual({ redacted: true, keys: ["internal"] });
  });

  it("redacts invoice bearer URLs", () => {
    const result = sanitizeStripeResponse({
      object: "invoice",
      id: "in_123",
      hosted_invoice_url: "https://invoice.stripe.com/i/secret",
      invoice_pdf: "https://invoice.stripe.com/i/secret.pdf",
    }) as Record<string, unknown>;

    expect(result.hosted_invoice_url).toEqual({ redacted: true });
    expect(result.invoice_pdf).toEqual({ redacted: true });
  });

  it("recursively sanitizes an expanded customer relation on a charge", () => {
    const result = sanitizeStripeResponse({
      object: "charge",
      id: "ch_123",
      customer: {
        object: "customer",
        id: "cus_123",
        email: "buyer@example.com",
      },
    }) as Record<string, unknown>;

    const customer = result.customer as Record<string, unknown>;
    expect(customer.id).toBe("cus_123");
    expect(customer.email).toBe("bu***@example.com");
  });

  it("redacts invoice URLs on a generic event-diff path, not just invoice objects", () => {
    const result = sanitizeStripeResponse({
      object: "event",
      id: "evt_123",
      type: "invoice.updated",
      data: {
        object: { object: "invoice", id: "in_1", hosted_invoice_url: "https://invoice.stripe.com/i/x" },
        previous_attributes: { hosted_invoice_url: "https://invoice.stripe.com/i/old" },
      },
    }) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    const previous = data.previous_attributes as Record<string, unknown>;
    expect(previous.hosted_invoice_url).toEqual({ redacted: true });
  });
});

describe("formatStripeError", () => {
  it("formats raw Stripe-like errors safely", () => {
    expect(
      formatStripeError({
        type: "rate_limit_error",
        message: "Too many requests",
        code: "rate_limit",
        requestId: "req_123",
      }),
    ).toEqual({
      type: "rate_limit_error",
      message: "Too many requests",
      code: "rate_limit",
      param: undefined,
      request_id: "req_123",
      retryable: true,
    });
  });
});
