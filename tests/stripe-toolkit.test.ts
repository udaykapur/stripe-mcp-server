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

describe("free-text sanitisation", () => {
  it("truncates long customer names", () => {
    const result = sanitizeStripeResponse({
      object: "customer",
      id: "cus_123",
      name: "A".repeat(80),
    }) as Record<string, unknown>;

    expect(typeof result.name).toBe("string");
    expect((result.name as string).length).toBeLessThan(80);
    expect((result.name as string)).toContain("[truncated");
  });

  it("passes short customer names through", () => {
    const result = sanitizeStripeResponse({
      object: "customer",
      id: "cus_123",
      name: "Jane Smith",
    }) as Record<string, unknown>;

    expect(result.name).toBe("Jane Smith");
  });

  it("truncates long descriptions on payment intents", () => {
    const result = sanitizeStripeResponse({
      object: "payment_intent",
      id: "pi_123",
      amount: 1000,
      currency: "usd",
      status: "requires_payment_method",
      description: "B".repeat(100),
    }) as Record<string, unknown>;

    expect((result.description as string)).toContain("[truncated");
  });

  it("truncates long product names", () => {
    const result = sanitizeStripeResponse({
      object: "product",
      id: "prod_123",
      name: "C".repeat(60),
    }) as Record<string, unknown>;

    expect((result.name as string)).toContain("[truncated");
  });

  it("truncates long descriptions in generic objects (event diff path)", () => {
    const result = sanitizeStripeResponse({
      object: "event",
      id: "evt_123",
      type: "payment_intent.updated",
      data: {
        object: {
          object: "payment_intent",
          id: "pi_123",
          amount: 1000,
          currency: "usd",
          status: "succeeded",
          description: "D".repeat(80),
        },
        previous_attributes: {
          description: "E".repeat(80),
        },
      },
    }) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    const obj = data.object as Record<string, unknown>;
    expect((obj.description as string)).toContain("[truncated");

    const prev = data.previous_attributes as Record<string, unknown>;
    expect((prev.description as string)).toContain("[truncated");
  });
});

describe("webhook URL sanitisation", () => {
  it("reduces webhook URL to origin only", () => {
    const result = sanitizeStripeResponse({
      object: "webhook_endpoint",
      id: "we_123",
      url: "https://example.com/webhook?token=secret123&key=abc",
      enabled_events: ["payment_intent.succeeded"],
    }) as Record<string, unknown>;

    expect(result.url).toBe("https://example.com");
  });

  it("strips path tokens and credentials from webhook URLs", () => {
    const result = sanitizeStripeResponse({
      object: "webhook_endpoint",
      id: "we_123",
      url: "https://:secret@example.com/webhook/sk_live_abc123",
      enabled_events: ["payment_intent.succeeded"],
    }) as Record<string, unknown>;

    expect(result.url).toBe("https://example.com");
  });

  it("reduces clean webhook URLs to origin", () => {
    const result = sanitizeStripeResponse({
      object: "webhook_endpoint",
      id: "we_123",
      url: "https://example.com/webhook",
      enabled_events: ["payment_intent.succeeded"],
    }) as Record<string, unknown>;

    expect(result.url).toBe("https://example.com");
  });
});

describe("expanded payment method sanitisation", () => {
  it("sanitises expanded default_payment_method in invoice_settings", () => {
    const result = sanitizeStripeResponse({
      object: "customer",
      id: "cus_123",
      invoice_settings: {
        default_payment_method: {
          object: "payment_method",
          id: "pm_123",
          billing_details: { name: "Secret Name", email: "a@b.com" },
          card: { last4: "4242" },
        },
        footer: "Footer text",
      },
    }) as Record<string, unknown>;

    const settings = result.invoice_settings as Record<string, unknown>;
    const pm = settings.default_payment_method as Record<string, unknown>;
    expect(pm.id).toBe("pm_123");
    expect(pm.billing_details).toEqual({ redacted: true });
  });
});

describe("URL-suffix key redaction", () => {
  it("redacts *_url keys to origin in event diff objects", () => {
    const result = sanitizeStripeResponse({
      object: "event",
      id: "evt_123",
      type: "checkout.session.completed",
      data: {
        object: {
          object: "checkout.session",
          id: "cs_123",
          status: "complete",
        },
        previous_attributes: {
          success_url: "https://shop.example.com/success?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://shop.example.com/cancel?cart=abc123",
          return_url: "https://shop.example.com/return?token=secret",
        },
      },
    }) as Record<string, unknown>;

    const data = result.data as Record<string, unknown>;
    const prev = data.previous_attributes as Record<string, unknown>;
    expect(prev.success_url).toBe("https://shop.example.com");
    expect(prev.cancel_url).toBe("https://shop.example.com");
    expect(prev.return_url).toBe("https://shop.example.com");
  });
});

describe("business_profile URL sanitisation", () => {
  it("reduces business_profile.url to origin", () => {
    const result = sanitizeStripeResponse({
      object: "account",
      id: "acct_123",
      business_profile: {
        name: "Test Corp",
        url: "https://testcorp.example.com/about?ref=stripe",
      },
    }) as Record<string, unknown>;

    const bp = result.business_profile as Record<string, unknown>;
    expect(bp.url).toBe("https://testcorp.example.com");
  });
});

describe("error message token redaction", () => {
  it("redacts secret keys from error messages", () => {
    const result = formatStripeError({
      type: "authentication_error",
      message: "Invalid API Key provided: sk_test_abc123def456",
      requestId: "req_999",
    });
    expect(result.message).not.toContain("sk_test_");
    expect(result.message).toContain("[key redacted]");
  });

  it("redacts webhook signing secrets from error messages", () => {
    const result = formatStripeError({
      type: "invalid_request_error",
      message: "Webhook secret whsec_abc123 is invalid",
      requestId: "req_888",
    });
    expect(result.message).not.toContain("whsec_");
    expect(result.message).toContain("[secret redacted]");
  });

  it("redacts client secrets from error messages", () => {
    const result = formatStripeError({
      type: "invalid_request_error",
      message: "PaymentIntent pi_abc_secret_xyz123 not found",
      requestId: "req_777",
    });
    expect(result.message).not.toContain("_secret_");
    expect(result.message).toContain("[secret redacted]");
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
