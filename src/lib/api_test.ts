import { assertEquals } from "jsr:@std/assert";

// Shim browser globals needed by api.ts → config.ts
if (!("window" in globalThis)) {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (!("localStorage" in globalThis)) {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}

// Test URL encoding in requestStellarChallenge
Deno.test("requestStellarChallenge URL-encodes public key", async () => {
  const calls: { url: string }[] = [];

  // Mock fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url });
    return Promise.resolve(new Response(
      JSON.stringify({ data: { challenge: "test-xdr" } }),
      { headers: { "Content-Type": "application/json" } },
    ));
  };

  try {
    // Dynamic import to avoid module-level side effects
    const { requestStellarChallenge } = await import("./api.ts");

    const testKey = "GABC+DEF/GHI";
    await requestStellarChallenge(testKey);

    assertEquals(calls.length, 1);
    assertEquals(
      calls[0].url.includes(encodeURIComponent(testKey)),
      true,
      "publicKey should be URL-encoded in the query string",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("verifyStellarChallenge sends signedChallenge in body", async () => {
  let capturedBody = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.body) {
      capturedBody = typeof init.body === "string" ? init.body : await new Response(init.body).text();
    }
    return new Response(
      JSON.stringify({ data: { jwt: "test-jwt" } }),
      { headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const { verifyStellarChallenge } = await import("./api.ts");

    const result = await verifyStellarChallenge("signed-xdr-123");
    const parsed = JSON.parse(capturedBody);

    assertEquals(parsed.signedChallenge, "signed-xdr-123");
    assertEquals(result.jwt, "test-jwt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
