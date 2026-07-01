# Stripe MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for Stripe payment operations. 52 tools across 8 domains, with built-in PII redaction and input validation.

Built for AI-assisted development workflows where Stripe API access needs to be both comprehensive and safe by default.

## Why this exists

Stripe's official remote MCP server (`mcp.stripe.com`) uses OAuth and includes doc search, but exposes a smaller toolset. This server runs locally, covers more of the Stripe API surface, and sanitises every response before it reaches the model context, so sensitive data never leaks into conversation history or logs.

|                  | This server              | Stripe official  |
| ---------------- | ------------------------ | ---------------- |
| Transport        | stdio (local)            | HTTP (remote)    |
| Auth             | `STRIPE_SECRET_KEY` env  | OAuth            |
| Tools            | 52                       | Smaller subset   |
| PII redaction    | Built-in                 | Stripe-managed   |
| Doc search       | No                       | Yes              |
| Idempotency keys | All mutating tools       | Varies           |
| Input validation | Strict schemas (Zod)     | Varies           |

The two servers complement each other. Run both if you want operational tools plus doc search.

## Tools (52)

### Customers (6)

`create_customer`, `retrieve_customer`, `update_customer`, `delete_customer`, `list_customers`, `search_customers`

### Payments (11)

`create_payment_intent`, `retrieve_payment_intent`, `confirm_payment_intent`, `capture_payment_intent`, `cancel_payment_intent`, `list_payment_intents`, `list_payment_methods`, `attach_payment_method`, `detach_payment_method`, `retrieve_charge`, `list_charges`

### Subscriptions (9)

`create_subscription`, `retrieve_subscription`, `update_subscription`, `cancel_subscription`, `list_subscriptions`, `create_product`, `list_products`, `create_price`, `list_prices`

### Invoices (8)

`create_invoice`, `retrieve_invoice`, `finalize_invoice`, `pay_invoice`, `void_invoice`, `list_invoices`, `retrieve_upcoming_invoice`, `create_invoice_item`

### Checkout (5)

`create_checkout_session`, `retrieve_checkout_session`, `list_checkout_sessions`, `create_coupon`, `list_coupons`

### Refunds (3)

`create_refund`, `retrieve_refund`, `list_refunds`

### Balance (5)

`retrieve_balance`, `list_balance_transactions`, `list_payouts`, `list_disputes`, `retrieve_dispute`

### Webhooks (5)

`create_webhook_endpoint`, `delete_webhook_endpoint`, `list_webhook_endpoints`, `list_events`, `retrieve_event`

## Resources (4)

Exposed as MCP resources (read-only, sanitised):

- `stripe://account` - current account details
- `stripe://balance` - balance by currency
- `stripe://webhook-endpoints` - registered webhook endpoints
- `stripe://products` - active product catalogue with default prices

## Prompts (4)

Pre-built prompt templates for common integration tasks:

- `review_stripe_integration` - security, error handling, and best-practice audit
- `setup_webhooks` - end-to-end webhook implementation guide per framework
- `design_pricing` - pricing model design with Stripe Products and Prices
- `troubleshoot_payment` - diagnose failed payments, declines, and disputes

## Security posture

Every Stripe API response is sanitised before reaching MCP output:

- **Secrets redacted**: webhook signing secrets, PaymentIntent `client_secret` values, including inside expanded nested objects
- **PII masked**: email addresses (shows first 2 chars + domain), phone numbers (shows last 4 digits), billing/shipping addresses fully redacted
- **URLs redacted**: hosted invoice URLs and invoice PDF links (bearer-style access tokens)
- **Metadata redacted**: values stripped, keys preserved for operator context
- **Unknown objects**: unrecognised Stripe object types reduced to a minimal envelope (`id`, `object`, `status`, `redacted: true`) instead of passed through raw
- **Input validation**: Stripe IDs, currency codes, webhook event names, API versions, checkout payment method types, and balance transaction types validated against Zod schemas. Enum validators are derived from the installed Stripe SDK's type declarations at startup; if those files change shape in a future SDK version, validators degrade to allow-all with a stderr warning rather than crashing
- **Idempotency**: all mutating tools accept optional `idempotency_key` (except deletions, which Stripe treats as inherently idempotent)
- **Pinned API version**: `2026-05-27.dahlia`, set in `src/stripe-client.ts`
- **Bounded runtime**: network retries capped at 0-5, timeout capped at 1-120 seconds

## Setup

### Prerequisites

- Node.js 18+ for runtime. Node ^20.19.0 or >=22.12.0 for running tests (Vite/Vitest dev dependency requirement)
- A Stripe account with API keys ([dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys))

### Install and build

```bash
git clone <repo-url>
cd stripe-mcp-server
npm install
npm run build
```

### Environment

```bash
cp .env.example .env
# Edit .env with your Stripe secret key
```

| Variable                     | Required | Default | Description                                                                                |
| ---------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `STRIPE_SECRET_KEY`          | Yes      | -       | Secret key (`sk_test_…`, `sk_live_…`) or restricted key (`rk_test_…`, `rk_live_…`)         |
| `STRIPE_MAX_NETWORK_RETRIES` | No       | `2`     | Max retries on transient failures (0-5)                                                    |
| `STRIPE_TIMEOUT_MS`          | No       | `30000` | Request timeout in milliseconds (1000-120000)                                              |

### Using restricted keys

For tighter security, use [restricted keys](https://docs.stripe.com/keys#limit-access) (`rk_*`) instead of full secret keys. Minimum permissions per tool group:

| Tool group    | Required permissions                                             |
| ------------- | ---------------------------------------------------------------- |
| Customers     | Customers: Read/Write                                            |
| Payments      | PaymentIntents, PaymentMethods, Charges: Read/Write              |
| Subscriptions | Subscriptions, Products, Prices: Read/Write                      |
| Invoices      | Invoices: Read/Write                                             |
| Checkout      | Checkout Sessions: Read/Write; Coupons: Read/Write               |
| Refunds       | Refunds: Read/Write (also needs Charges or PaymentIntents: Read) |
| Balance       | Balance: Read; Payouts: Read; Disputes: Read                     |
| Webhooks      | Webhook Endpoints: Read/Write; Events: Read                      |

Grant only the groups you need. Read-only tools (list/retrieve) need only Read permission on their resource.

### Wire into your MCP client

#### Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "stripe": {
      "command": "node",
      "args": ["/absolute/path/to/stripe-mcp-server/dist/index.js"],
      "env": {
        "STRIPE_SECRET_KEY": "sk_test_..."
      }
    }
  }
}
```

#### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "stripe": {
      "command": "node",
      "args": ["/absolute/path/to/stripe-mcp-server/dist/index.js"],
      "env": {
        "STRIPE_SECRET_KEY": "sk_test_..."
      }
    }
  }
}
```

#### Other MCP clients

Any client that supports stdio transport can run this server. Point it at `dist/index.js` with `STRIPE_SECRET_KEY` in the environment.

## Verification

```bash
npm test        # 42 tests (sanitisation, config validation, schema checks)
npm run build   # TypeScript compilation to dist/
```

## Project structure

```text
src/
  index.ts                   # Server entry point, tool/resource/prompt registration
  stripe-client.ts           # Stripe SDK singleton with pinned version and bounded config
  tools/
    balance.ts               # Balance and payout tools
    checkout.ts              # Checkout Session and coupon tools
    customers.ts             # Customer CRUD and search
    invoices.ts              # Invoice lifecycle tools
    payments.ts              # PaymentIntent and PaymentMethod tools
    refunds.ts               # Refund tools
    subscriptions.ts         # Subscription, Product, and Price tools
    webhooks.ts              # Webhook endpoint and event tools
  resources/index.ts         # MCP resources (account, balance, webhooks, products)
  prompts/index.ts           # MCP prompt templates
  utils/stripe-toolkit.ts    # Sanitisation, validation schemas, error formatting
tests/
  stripe-toolkit.test.ts     # Sanitisation and masking tests
  stripe-config-and-schemas.test.ts  # Config validation and schema tests
```

## Design decisions

**Sanitise by default, not by opt-in.** Every Stripe object type has an explicit sanitisation path. Unknown object types are reduced rather than passed through. This means new Stripe object types added in future API versions are safe by default (they show `id`, `status`, and `redacted: true` until an explicit handler is added).

**Validate from Stripe's own type definitions.** Checkout payment method types, webhook event names, and API versions are loaded at startup from the installed Stripe SDK's TypeScript declaration files. When you upgrade the Stripe SDK, the validators update automatically. If the SDK restructures its type files in a future major version, validators degrade to allow-all with a stderr warning rather than crashing. The wildcard `*` webhook event is always rejected regardless of validator state.

**No stored state.** The server holds no data between requests beyond the Stripe SDK client singleton. All state lives in Stripe's API.

## Licence

MIT
