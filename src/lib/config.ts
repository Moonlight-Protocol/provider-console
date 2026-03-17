/**
 * Console configuration.
 * Reads from global config object set in index.html or defaults.
 */
declare global {
  interface Window {
    __CONSOLE_CONFIG__?: {
      apiBaseUrl?: string;
      posthogKey?: string;
      posthogHost?: string;
      environment?: string;
      grafana?: {
        baseUrl?: string;
        publicDashboardUrl?: string;
        panels?: Array<{
          title: string;
          src: string;
          height?: number;
        }>;
      };
    };
  }
}

const config = window.__CONSOLE_CONFIG__ ?? {};

export const API_BASE_URL = config.apiBaseUrl ?? "http://localhost:8000/api/v1";
export const POSTHOG_KEY = config.posthogKey ?? "";
export const POSTHOG_HOST = config.posthogHost ?? "https://us.i.posthog.com";
export const ENVIRONMENT = config.environment ?? "development";
export const IS_PRODUCTION = ENVIRONMENT === "production";
export const GRAFANA_CONFIG = config.grafana ?? { baseUrl: "https://aha.grafana.net", publicDashboardUrl: "", panels: [] };
