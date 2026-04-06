/**
 * API client for the provider-platform dashboard endpoints.
 * Auth follows the exact same pattern as council-console/lib/platform.ts.
 */
import { API_BASE_URL } from "./config.ts";
import { signMessage, getConnectedAddress } from "./wallet.ts";

const TOKEN_KEY = "console_token";

let authToken: string | null = localStorage.getItem(TOKEN_KEY);

/**
 * Authenticate with provider-platform via challenge-response.
 * The wallet signs the nonce (SEP-53), platform verifies and returns a JWT.
 */
export async function authenticate(): Promise<string> {
  const publicKey = getConnectedAddress();
  if (!publicKey) throw new Error("Wallet not connected");

  const challengeRes = await fetch(`${API_BASE_URL}/dashboard/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey }),
  });
  if (!challengeRes.ok) {
    throw new Error(`Failed to get auth challenge: ${challengeRes.status}`);
  }
  const { data: { nonce } } = await challengeRes.json();

  const signature = await signMessage(nonce);

  const verifyRes = await fetch(`${API_BASE_URL}/dashboard/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, signature, publicKey }),
  });
  if (!verifyRes.ok) {
    throw new Error("Platform authentication failed");
  }
  const { data: { token } } = await verifyRes.json();

  authToken = token;
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function isAuthenticated(): boolean {
  if (!authToken) return false;
  try {
    const b64 = authToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearPlatformAuth();
      return false;
    }
  } catch {
    clearPlatformAuth();
    return false;
  }
  return true;
}

export function clearPlatformAuth(): void {
  authToken = null;
  localStorage.removeItem(TOKEN_KEY);
}

async function platformFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  if (!authToken) throw new Error("Not authenticated. Please sign in first.");

  const doFetch = () =>
    fetch(`${API_BASE_URL}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        ...(opts.headers as Record<string, string> ?? {}),
      },
    });

  const res = await doFetch();
  if (res.status === 401) {
    clearPlatformAuth();
    window.location.hash = "#/login";
    throw new Error("Session expired");
  }
  return res;
}

// --- Signing ---

/**
 * Sign a payload with a Stellar secret key (Ed25519).
 * Matches the council-platform's verifyPayload format:
 *   SHA-256(JSON.stringify({ payload, timestamp })) → Ed25519 sign → base64
 */
export async function signPayload<T>(payload: T, secretKey: string): Promise<{
  payload: T; signature: string; publicKey: string; timestamp: number;
}> {
  const { Keypair } = await import("stellar-base");
  const { Buffer } = await import("buffer");
  const keypair = Keypair.fromSecret(secretKey);
  const timestamp = Date.now();
  const canonical = JSON.stringify({ payload, timestamp });
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  const signature = Buffer.from(keypair.sign(Buffer.from(hash))).toString("base64");
  return { payload, signature, publicKey: keypair.publicKey(), timestamp };
}

// --- PP management ---

export interface PpInfo {
  publicKey: string;
  derivationIndex: number;
  label: string | null;
  isActive: boolean;
  createdAt: string;
  councilMembership: {
    councilUrl: string;
    councilName: string | null;
    status: string;
    channelAuthId: string;
  } | null;
}

export async function registerPp(secretKey: string, derivationIndex: number, label?: string): Promise<{ publicKey: string }> {
  const res = await platformFetch("/dashboard/pp/register", {
    method: "POST",
    body: JSON.stringify({ secretKey, derivationIndex, label }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to register PP");
  }
  const { data } = await res.json();
  return data;
}

export async function listPps(): Promise<PpInfo[]> {
  const res = await platformFetch("/dashboard/pp/list");
  if (!res.ok) throw new Error("Failed to list PPs");
  const { data } = await res.json();
  return data;
}

export async function deletePp(publicKey: string): Promise<void> {
  const res = await platformFetch("/dashboard/pp/delete", {
    method: "POST",
    body: JSON.stringify({ publicKey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to delete provider");
  }
}


// --- Council (UC2) ---

export interface CouncilInfo {
  councilUrl: string;
  council: {
    name: string;
    description: string | null;
    contactEmail: string | null;
    channelAuthId: string;
    councilPublicKey: string;
  };
  jurisdictions: Array<{ countryCode: string; label: string | null }>;
  channels: Array<{ channelContractId: string; assetCode: string; label: string | null }>;
  providers: Array<{ publicKey: string; label: string | null }>;
}

export async function discoverCouncil(councilUrl: string): Promise<CouncilInfo> {
  const res = await platformFetch("/dashboard/council/discover", {
    method: "POST",
    body: JSON.stringify({ councilUrl }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Discovery failed: HTTP ${res.status}`);
  }
  const { data } = await res.json();
  return data;
}

export async function joinCouncil(data: {
  councilUrl: string;
  councilId: string;
  councilName?: string;
  councilPublicKey?: string;
  ppPublicKey: string;
  signedEnvelope: { payload: unknown; signature: string; publicKey: string; timestamp: number };
}): Promise<{ joinRequestId: string; status: string }> {
  const res = await platformFetch("/dashboard/council/join", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to join council");
  }
  const { data: resData } = await res.json();
  return resData;
}

export interface CouncilMembership {
  id: string;
  councilUrl: string;
  councilName: string | null;
  councilPublicKey: string;
  channelAuthId: string;
  status: "PENDING" | "ACTIVE" | "REJECTED";
  config: Record<string, unknown> | null;
  joinRequestId: string | null;
  ppPublicKey: string | null;
  createdAt: string;
}

export async function getCouncilMembership(ppPublicKey: string): Promise<CouncilMembership | null> {
  const res = await platformFetch(`/dashboard/council/membership?ppPublicKey=${encodeURIComponent(ppPublicKey)}`);
  if (!res.ok) throw new Error("Failed to retrieve membership");
  const { data } = await res.json();
  return data;
}

/**
 * Sync a PP's membership status via the provider-platform.
 * The platform queries the council and updates its local DB.
 * Returns the synced status.
 */
export async function checkMembershipStatus(ppPublicKey: string): Promise<"ACTIVE" | "PENDING" | "REJECTED"> {
  const res = await platformFetch("/dashboard/council/membership", {
    method: "POST",
    body: JSON.stringify({ ppPublicKey }),
  });
  if (!res.ok) return "PENDING";
  const { data } = await res.json();
  return data?.status ?? "PENDING";
}

// --- Treasury (for fund check) ---

export interface TreasuryData {
  address: string;
  sequence: string;
  balances: Array<{ asset_type: string; asset_code?: string; balance: string }>;
  lastModifiedLedger: number;
}

export async function getTreasury(): Promise<TreasuryData> {
  const res = await platformFetch("/dashboard/treasury");
  if (!res.ok) throw new Error("Failed to fetch treasury info");
  const { data } = await res.json();
  return data;
}
