# Development Handoff

Last updated: 2026-06-23

## Current state

- 52 tools across 8 domains (customers, payments, subscriptions, invoices, refunds, checkout, balance, webhooks)
- 4 MCP resources (account, balance, webhook endpoints, product catalogue)
- 4 MCP prompt templates (integration review, webhook setup, pricing design, payment troubleshooting)
- All responses sanitised: PII masked, secrets redacted, unknown objects reduced to safe envelopes
- Strict input validation via Zod schemas derived from Stripe SDK type definitions
- Idempotency key support on all mutating tools (except deletions)
- Pinned Stripe API version: `2025-02-24.acacia`
- Tests and build green: 19 tests passing, `npm run build` succeeds

## Key files

| File                                      | Purpose                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| `src/stripe-client.ts`                    | SDK singleton, API version pin, bounded runtime config    |
| `src/utils/stripe-toolkit.ts`             | Sanitisation engine, validation schemas, error formatting |
| `src/tools/*.ts`                          | Tool implementations by domain                            |
| `src/resources/index.ts`                  | Read-only MCP resources                                   |
| `src/prompts/index.ts`                    | Prompt templates                                          |
| `tests/stripe-toolkit.test.ts`            | Sanitisation and masking coverage                         |
| `tests/stripe-config-and-schemas.test.ts` | Config bounds and schema validation                       |

## Guardrails for future work

- Do not return raw Stripe objects through tools or resources. Every object type needs an explicit sanitisation path.
- Keep the default for unknown Stripe object types conservative (minimal envelope, `redacted: true`).
- Keep metadata values redacted; preserve keys only.
- Keep idempotency limited to mutating operations.
- When upgrading the Stripe SDK, rerun the full test and build suite. The type-union-derived validators (checkout payment method types, webhook events, API versions, balance transaction types) update automatically from the SDK's declaration files.
- Do not weaken runtime config bounds (`STRIPE_MAX_NETWORK_RETRIES` 0-5, `STRIPE_TIMEOUT_MS` 1000-120000) without a clear operational reason.
- Do not add tools that expose raw webhook signing secrets or PaymentIntent `client_secret` values.

## Verification

```bash
npm test        # 19 tests
npm run build   # TypeScript to dist/
npm run typecheck  # Type checking without emit
```
