/**
 * Console configuration.
 * Reads from global config object set in index.html or defaults.
 */
declare global {
  interface Window {
    __CONSOLE_CONFIG__?: {
      apiBaseUrl?: string;
      stellarNetwork?: "testnet" | "mainnet" | "standalone";
      posthogKey?: string;
      posthogHost?: string;
      environment?: string;
    };
  }
}

const config = window.__CONSOLE_CONFIG__ ?? {};

export const API_BASE_URL = config.apiBaseUrl ?? "http://localhost:8000/api/v1";
export const POSTHOG_KEY = config.posthogKey ?? "";
export const POSTHOG_HOST = config.posthogHost ?? "https://us.i.posthog.com";
export const ENVIRONMENT = config.environment ?? "development";
export const IS_PRODUCTION = ENVIRONMENT === "production";
export const STELLAR_NETWORK = config.stellarNetwork ?? "testnet";
