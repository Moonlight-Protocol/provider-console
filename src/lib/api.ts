import { API_BASE_URL } from "./config.ts";

/**
 * API client for the provider-platform dashboard endpoints.
 */

let authToken: string | null = null;

export function setToken(token: string): void {
  authToken = token;
  localStorage.setItem("console_token", token);
}

export function getToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem("console_token");
  }
  return authToken;
}

export function clearToken(): void {
  authToken = null;
  localStorage.removeItem("console_token");
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;

  // Check JWT expiry (tokens are base64url-encoded JSON)
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) {
      clearToken();
      return false;
    }
  } catch {
    clearToken();
    return false;
  }
  return true;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (response.status === 401) {
    clearToken();
    window.location.hash = "#/login";
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }

  // Handle CSV responses
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("text/csv")) {
    return (await response.text()) as unknown as T;
  }

  return response.json();
}

// --- Auth (SEP-10 transaction-based challenge) ---

export async function requestStellarChallenge(publicKey: string): Promise<{ challenge: string }> {
  const res = await request<{ data: { challenge: string } }>(`/stellar/auth?account=${encodeURIComponent(publicKey)}`, {
    method: "GET",
  });
  return res.data;
}

export async function verifyStellarChallenge(signedChallenge: string): Promise<{ jwt: string }> {
  const res = await request<{ data: { jwt: string } }>("/stellar/auth", {
    method: "POST",
    body: JSON.stringify({ signedChallenge }),
  });
  return res.data;
}

// --- Dashboard data ---

export async function getChannels() {
  return request<{ data: { channels: unknown[]; summary: unknown } }>("/dashboard/channels");
}

export async function getMempool() {
  return request<{ data: { platformVersion: string; live: unknown; averages: unknown; config: unknown } }>("/dashboard/mempool");
}

export async function getOperations() {
  return request<{ data: { bundles: unknown; transactions: unknown } }>("/dashboard/operations");
}

export async function getTreasury() {
  return request<{ data: { address: string; sequence: string; balances: unknown[]; lastModifiedLedger: number } }>("/dashboard/treasury");
}

export async function getAuditExport(status = "COMPLETED", from?: string, to?: string): Promise<string> {
  const params = new URLSearchParams({ status });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return request<string>(`/dashboard/audit-export?${params}`);
}
