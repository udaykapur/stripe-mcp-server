/**
 * Prompts — Pre-built prompt templates for common Stripe integration tasks.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  /**
   * Review a Stripe integration for best practices and common pitfalls.
   */
  server.registerPrompt(
    "review_stripe_integration",
    {
      title: "Review Stripe Integration",
      description:
        "Get a comprehensive review of your Stripe integration covering security, error handling, webhook reliability, and best practices.",
      argsSchema: {
        integration_type: z
          .enum(["checkout", "elements", "direct_api", "subscriptions", "invoicing", "connect"])
          .describe("Type of Stripe integration to review"),
        code_snippet: z
          .string()
          .optional()
          .describe("Paste relevant code for specific feedback"),
      },
    },
    ({ integration_type, code_snippet }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Review this Stripe integration (type: ${integration_type}) for best practices.

## Review Checklist

### Security
- [ ] API keys are not exposed client-side
- [ ] Webhook signatures are verified using stripe.webhooks.constructEvent()
- [ ] HTTPS is enforced for all Stripe communication
- [ ] PCI compliance requirements are met for the integration type
- [ ] Sensitive data is not logged

### Error Handling
- [ ] StripeCardError is caught and user-friendly messages shown
- [ ] StripeRateLimitError triggers exponential backoff
- [ ] StripeInvalidRequestError is logged with context
- [ ] StripeAPIError / StripeConnectionError triggers retries
- [ ] Idempotency keys are used for create/update operations

### Webhook Reliability
- [ ] Endpoint returns 200 quickly (processing is async)
- [ ] Events are handled idempotently (re-processing is safe)
- [ ] Relevant events are subscribed (not using "*" in production)
- [ ] Failed deliveries are monitored
- [ ] Event objects are fetched fresh when needed (not relying solely on webhook payload)

### Payment Flow
- [ ] PaymentIntent status is checked server-side (not just client)
- [ ] Amount and currency are set server-side (not from client)
- [ ] Confirmation is handled for 3D Secure / SCA
- [ ] Refund edge cases are handled (partial, failed)
- [ ] Currency handling uses smallest unit correctly

### Subscriptions (if applicable)
- [ ] Subscription lifecycle events are handled (created, updated, deleted)
- [ ] Payment failures trigger dunning / customer notification
- [ ] Proration is configured intentionally
- [ ] Trial periods are set server-side
- [ ] Cancellation flows preserve customer data appropriately

${code_snippet ? `### Code to Review\n\`\`\`\n${code_snippet}\n\`\`\`` : ""}

Provide specific, actionable feedback for each area.`,
          },
        },
      ],
    }),
  );

  /**
   * Guide for setting up Stripe webhooks end-to-end.
   */
  server.registerPrompt(
    "setup_webhooks",
    {
      title: "Setup Stripe Webhooks",
      description:
        "Step-by-step guide for implementing Stripe webhook handling in your application.",
      argsSchema: {
        framework: z
          .string()
          .describe('Your web framework (e.g. "express", "nextjs", "fastify", "django", "rails")'),
        events: z
          .string()
          .optional()
          .describe('Comma-separated events to handle (e.g. "payment_intent.succeeded,customer.subscription.deleted")'),
      },
    },
    ({ framework, events }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me set up Stripe webhook handling for my ${framework} application.

## Requirements

1. **Endpoint Setup**: Create a webhook endpoint that:
   - Accepts POST requests with raw body (not JSON-parsed)
   - Verifies the Stripe signature using the webhook secret
   - Returns 200 quickly, processes events asynchronously

2. **Events to Handle**: ${events || "payment_intent.succeeded, payment_intent.payment_failed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed, checkout.session.completed"}

3. **Event Processing**: For each event type, show:
   - How to extract the relevant object
   - What database updates / business logic to perform
   - Error handling and idempotency patterns

4. **Local Development**: How to test webhooks locally using Stripe CLI:
   - stripe listen --forward-to localhost:PORT/webhook
   - stripe trigger payment_intent.succeeded

5. **Production Checklist**:
   - Register endpoint in Stripe Dashboard or via API
   - Store webhook secret securely (env var)
   - Monitor for failed deliveries
   - Handle retries gracefully

Provide complete, production-ready code for the ${framework} framework.`,
          },
        },
      ],
    }),
  );

  /**
   * Design a pricing model with Stripe Products and Prices.
   */
  server.registerPrompt(
    "design_pricing",
    {
      title: "Design Pricing Model",
      description:
        "Help design and implement a pricing model using Stripe Products, Prices, and Subscriptions.",
      argsSchema: {
        business_model: z
          .enum(["saas", "marketplace", "ecommerce", "usage_based", "hybrid"])
          .describe("Your business model type"),
        tiers: z
          .string()
          .optional()
          .describe('Describe your pricing tiers (e.g. "free, pro at $29/mo, enterprise custom")'),
      },
    },
    ({ business_model, tiers }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me design a pricing model for my ${business_model} business using Stripe.

${tiers ? `Desired tiers: ${tiers}` : ""}

## Please Cover

1. **Product Structure**: How to organize Stripe Products
   - One product per tier vs. one product with multiple prices
   - Naming conventions and metadata strategy

2. **Price Configuration**:
   - Recurring vs. one-time prices
   - Per-seat, flat-rate, tiered, or usage-based pricing
   - Trial periods and introductory offers
   - Multi-currency support

3. **Subscription Logic**:
   - Upgrade/downgrade flows (proration strategies)
   - Free tier implementation (price of $0 vs. feature flags)
   - Grace periods for failed payments
   - Cancellation and reactivation flows

4. **Implementation Plan**: Stripe API calls to create the pricing model
   - Product creation
   - Price creation for each tier
   - Checkout Session or Subscription creation flow

5. **Customer Portal**: Using Stripe Customer Portal for self-service
   - Plan changes
   - Payment method updates
   - Invoice history

Provide concrete Stripe API examples using the tools available in this MCP server.`,
          },
        },
      ],
    }),
  );

  /**
   * Troubleshoot a failed payment or integration issue.
   */
  server.registerPrompt(
    "troubleshoot_payment",
    {
      title: "Troubleshoot Payment Issue",
      description:
        "Diagnose and resolve a failed payment, declined charge, or integration error.",
      argsSchema: {
        error_message: z
          .string()
          .optional()
          .describe("The error message or decline code you received"),
        payment_intent_id: z
          .string()
          .optional()
          .describe("PaymentIntent ID to investigate (pi_...)"),
        issue_type: z
          .enum([
            "declined",
            "authentication_required",
            "webhook_failure",
            "subscription_past_due",
            "refund_failed",
            "dispute",
            "other",
          ])
          .describe("Type of issue"),
      },
    },
    ({ error_message, payment_intent_id, issue_type }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me troubleshoot this Stripe payment issue.

**Issue Type**: ${issue_type}
${error_message ? `**Error Message**: ${error_message}` : ""}
${payment_intent_id ? `**PaymentIntent ID**: ${payment_intent_id} (use retrieve_payment_intent to inspect)` : ""}

## Diagnostic Steps

1. **Retrieve the object**: Use the appropriate retrieve tool to get the current state
2. **Check the status**: Identify where in the payment flow the issue occurred
3. **Review events**: Use list_events to see what Stripe events were fired
4. **Check logs**: Look at the last_payment_error or failure details
5. **Identify root cause**: Map the error/decline code to a resolution

## Common Issues by Type

- **declined**: Check decline_code, suggest customer action or alternative payment method
- **authentication_required**: Ensure 3D Secure / SCA flow is implemented
- **webhook_failure**: Check endpoint status, verify signature, check for timeouts
- **subscription_past_due**: Review dunning settings, suggest retry or payment method update
- **refund_failed**: Check original charge status, partial refund availability
- **dispute**: Review evidence submission deadline and required documents

Provide a step-by-step resolution plan.`,
          },
        },
      ],
    }),
  );
}
