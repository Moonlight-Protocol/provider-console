/**
 * Consume provider-platform's structured error contract and map the machine
 * code to operator-facing copy.
 *
 * provider-platform returns `StructuredError { code, source?, message, details? }`
 * (its PlatformError wire shape is `{ code, status, message, details }`) on any
 * non-2xx from the dashboard/auth/entity/bundle endpoints this console calls.
 * We read the `code` and map it to a message aimed at a provider **operator**
 * (running the infra) — so the copy is more technical/actionable than end-user
 * copy — never a raw internal string or a bare HTTP status.
 *
 * Mirrors moonlight-pay `src/lib/dom.ts` `friendlyError`: known code → copy,
 * unknown code → the body message (only if it's a safe human sentence), else a
 * generic last resort.
 *
 * moonlight-sdk v0.11.1 does not export a `StructuredError` type or a code enum
 * (it exports the contract-error catalog + `decodeContractError`), so the type
 * and the code→copy map are defined locally here.
 */

/** The structured error body provider-platform returns on a non-2xx response. */
export interface StructuredError {
  code?: string;
  source?: string;
  message?: string;
  details?: string;
  /** HTTP status of the response the error came from. */
  status?: number;
}

/**
 * An Error carrying the provider-platform error `code` alongside a message
 * that has already been mapped to operator copy. Views that render
 * `err.message` therefore show the mapped copy without further work.
 */
export class ConsoleError extends Error {
  readonly code?: string;
  readonly source?: string;
  readonly details?: string;
  readonly status?: number;

  constructor(message: string, structured: StructuredError = {}) {
    super(message);
    this.name = "ConsoleError";
    this.code = structured.code;
    this.source = structured.source;
    this.details = structured.details;
    this.status = structured.status;
  }
}

/**
 * Machine code → operator-facing copy. Covers the codes the console's
 * endpoints return: SEP-53 challenge verify (`AUTH_VR_*` / `ACH_*`), JWT
 * (`HTTP_AUTH_*`), payload validation (`HTTP_PRO_001`), and the bundle-read
 * codes (`BND_*`). Extend as new codes appear on the wire.
 */
const CODE_COPY: Record<string, string> = {
  // ── Sign-in challenge verification (SEP-53) ──────────────────────────────
  AUTH_VR_002:
    "Sign-in challenge not found or already used. Start sign-in again.",
  AUTH_VR_003: "Sign-in nonce didn't match. Start sign-in again.",
  AUTH_VR_004:
    "The signing wallet doesn't match the account being authenticated.",
  AUTH_VR_005: "Sign-in challenge timing was off. Start sign-in again.",
  AUTH_VR_014:
    "Sign-in challenge was used too early — check this machine's clock, then retry.",
  AUTH_VR_015: "Sign-in challenge expired before it was signed. Sign in again.",
  AUTH_VR_016:
    "The platform didn't co-sign the challenge — a platform-side issue. Check provider-platform logs.",
  AUTH_VR_017:
    "The challenge wasn't signed by your wallet. Approve the signature and retry.",
  AUTH_VR_018:
    "Sign-in challenge failed verification. Retry; if it persists, confirm the wallet key.",
  ACH_VR_001: "Malformed sign-in challenge. Start sign-in again.",
  ACH_ST_003: "A sign-in session already exists for this wallet.",
  ACH_ST_004:
    "Sign-in challenge not found or already used. Start sign-in again.",
  ACH_ST_007:
    "This wallet isn't a registered operator on this provider platform.",
  // ── JWT / session ────────────────────────────────────────────────────────
  HTTP_AUTH_001: "Missing authorization. Please sign in again.",
  HTTP_AUTH_002: "Invalid authorization header. Please sign in again.",
  HTTP_AUTH_003: "Your session expired. Please sign in again.",
  HTTP_AUTH_004: "Your session token was rejected. Please sign in again.",
  // ── Request validation ───────────────────────────────────────────────────
  HTTP_PRO_001:
    "The request was rejected as malformed — likely a console/platform version mismatch.",
  // ── Bundle reads ─────────────────────────────────────────────────────────
  BND_008: "That bundle no longer exists on the provider platform.",
  BND_009: "You're not allowed to view that bundle.",
  BND_011: "The submitter isn't an approved entity on this provider.",
  BND_013: "That privacy provider isn't registered on this platform.",
  BND_014: "This provider isn't a member of that channel.",
  BND_015: "That channel is disabled (withdraw-only) by its council.",
  BND_016: "The chain is temporarily unreachable — retry shortly.",
};

/** Generic last-resort copy when there's no code and no safe body message. */
const GENERIC =
  "The provider platform returned an error. Check the provider-platform logs for details.";

/**
 * A message is safe to show verbatim only if it reads like a human sentence:
 * starts with a capital, has spaces, and carries no technical tokens (raw
 * status words, version strings, error codes, `snake_case`/errno identifiers).
 * Mirrors moonlight-pay's guard so raw internal strings never reach the UI.
 */
export function isSafeSentence(msg: string): boolean {
  return (
    msg.length > 10 && msg.length < 200 && /^[A-Z]/.test(msg) &&
    msg.includes(" ") && !/\d+\.\d+\.\d+/.test(msg) &&
    !/\b[A-Z]{4,}\b/.test(msg) && !msg.includes("_") &&
    !msg.includes("ECONN") && !msg.includes("ENOENT")
  );
}

/**
 * Map a StructuredError to operator copy: known code → mapped copy; unknown
 * code → the body message (only if it's a safe sentence); else `fallback`, else
 * a generic string. Never returns a raw internal string or a bare status.
 */
export function operatorMessage(
  err: StructuredError,
  fallback?: string,
): string {
  if (err.code && err.code in CODE_COPY) return CODE_COPY[err.code];
  if (err.message && isSafeSentence(err.message)) return err.message;
  return fallback ?? GENERIC;
}

/**
 * Read the StructuredError from a non-ok Response and build a ConsoleError
 * whose message is already mapped to operator copy. `context` is a per-endpoint
 * fallback (e.g. "Failed to register the provider") used only when there's no
 * mapped code and no safe body message.
 */
export async function platformError(
  res: Response,
  context: string,
): Promise<ConsoleError> {
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  const structured: StructuredError = {
    code: typeof body.code === "string" ? body.code : undefined,
    source: typeof body.source === "string" ? body.source : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    details: typeof body.details === "string" ? body.details : undefined,
    status: res.status,
  };
  return new ConsoleError(operatorMessage(structured, context), structured);
}
