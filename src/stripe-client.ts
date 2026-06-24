/**
 * Stripe client configuration and lazy singleton.
 */
import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-05-27.dahlia" as const;
const DEFAULT_MAX_NETWORK_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_NETWORK_RETRIES_LIMIT = 5;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

export interface StripeRuntimeConfig {
  apiVersion: typeof STRIPE_API_VERSION;
  maxNetworkRetries: number;
  timeout: number;
}

let stripeClient: Stripe | null = null;

export function resetStripeClientForTests(): void {
  stripeClient = null;
}

export function getStripeRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): StripeRuntimeConfig {
  return {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: parseOptionalInteger(
      env["STRIPE_MAX_NETWORK_RETRIES"],
      DEFAULT_MAX_NETWORK_RETRIES,
      "STRIPE_MAX_NETWORK_RETRIES",
      0,
      MAX_NETWORK_RETRIES_LIMIT,
    ),
    timeout: parseOptionalInteger(
      env["STRIPE_TIMEOUT_MS"],
      DEFAULT_TIMEOUT_MS,
      "STRIPE_TIMEOUT_MS",
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
  };
}

export function getStripeClient(
  env: NodeJS.ProcessEnv = process.env,
): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  const apiKey = env["STRIPE_SECRET_KEY"]?.trim();
  if (!apiKey) {
    throw new StripeConfigError(
      "STRIPE_SECRET_KEY environment variable is required.",
    );
  }

  if (!/^[rs]k_(test|live)_/.test(apiKey)) {
    throw new StripeConfigError(
      "STRIPE_SECRET_KEY must be a secret key (sk_test_..., sk_live_...) or restricted key (rk_test_..., rk_live_...). Publishable keys (pk_...) are not supported.",
    );
  }

  const runtimeConfig = getStripeRuntimeConfig(env);
  stripeClient = new Stripe(apiKey, runtimeConfig);
  return stripeClient;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripeClient();
    const value = Reflect.get(client as object, prop, receiver);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});

function parseOptionalInteger(
  rawValue: string | undefined,
  defaultValue: number,
  envName: string,
  minValue: number,
  maxValue: number,
): number {
  if (rawValue == null || rawValue.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < minValue || parsed > maxValue) {
    throw new StripeConfigError(
      `${envName} must be an integer between ${minValue} and ${maxValue}.`,
    );
  }

  return parsed;
}
