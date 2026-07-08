import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import {
  bundleStageTitle,
  ConsoleError,
  failureReason,
  isSafeSentence,
  operatorMessage,
  platformError,
  type StructuredError,
} from "./errors.ts";

Deno.test("operatorMessage — known code maps to operator copy", () => {
  assertEquals(
    operatorMessage({ code: "AUTH_VR_015", message: "raw internal string" }),
    "Sign-in challenge expired before it was signed. Sign in again.",
  );
  assertEquals(
    operatorMessage({ code: "BND_008" }),
    "That bundle no longer exists on the provider platform.",
  );
  assertEquals(
    operatorMessage({ code: "HTTP_AUTH_003" }),
    "Your session expired. Please sign in again.",
  );
});

Deno.test("operatorMessage — unknown code falls back to a safe body message", () => {
  const err: StructuredError = {
    code: "SOME_UNMAPPED_CODE",
    message: "The council rejected the join request.",
  };
  assertEquals(operatorMessage(err), "The council rejected the join request.");
});

Deno.test("operatorMessage — unsafe body message falls through to fallback/generic", () => {
  // Raw status token / snake_case / errno must not reach the UI.
  assertEquals(
    operatorMessage({ message: "Bundle X FAILED" }, "Failed to load."),
    "Failed to load.",
  );
  assertEquals(
    operatorMessage({ message: "ECONN_REFUSED at 127.0.0.1:5432" }),
    "The provider platform returned an error. Check the provider-platform logs for details.",
  );
  // No code, no message → generic.
  assertEquals(
    operatorMessage({}),
    "The provider platform returned an error. Check the provider-platform logs for details.",
  );
  // No code, no message, with a context fallback → the fallback.
  assertEquals(
    operatorMessage({}, "Failed to register the provider."),
    "Failed to register the provider.",
  );
});

Deno.test("isSafeSentence — accepts human sentences, rejects technical tokens", () => {
  assert(isSafeSentence("The council rejected the join request."));
  assert(!isSafeSentence("FAILED"));
  assert(!isSafeSentence("http_pro_001 invalid"));
  assert(!isSafeSentence("v1.2.3 mismatch"));
  assert(!isSafeSentence("short"));
});

Deno.test("platformError — reads StructuredError body, maps code, carries code", async () => {
  const res = new Response(
    JSON.stringify({
      code: "BND_015",
      status: 403,
      message: "Channel is disabled (withdraw-only)",
      details: "…",
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
  const err = await platformError(res, "Failed to fetch bundle detail.");
  assertInstanceOf(err, ConsoleError);
  assertEquals(err.code, "BND_015");
  assertEquals(err.status, 403);
  assertEquals(
    err.message,
    "That channel is disabled (withdraw-only) by its council.",
  );
});

Deno.test("failureReason — maps SOROBAN_* on-chain codes to descriptive operator copy", () => {
  assertEquals(
    failureReason({ code: "SOROBAN_1010", source: "onchain", message: "raw" }),
    "On-chain: the authorization signature expired before it was submitted.",
  );
  assertEquals(
    failureReason({ code: "SOROBAN_2003", source: "onchain" }),
    "On-chain: the bundle didn't balance (inputs ≠ outputs).",
  );
  assertEquals(
    failureReason({ code: "PROVIDER_EXECUTION_FAILED", source: "provider" }),
    "The bundle could not be submitted to the network.",
  );
});

Deno.test("failureReason — unknown SOROBAN code falls back to the failureDetail message", () => {
  assertEquals(
    failureReason({
      code: "SOROBAN_9999",
      source: "onchain",
      message: "A brand-new on-chain condition was not satisfied.",
    }),
    "A brand-new on-chain condition was not satisfied.",
  );
});

Deno.test("failureReason — null/absent detail yields null (no reason to show)", () => {
  assertEquals(failureReason(null), null);
  assertEquals(failureReason(undefined), null);
});

Deno.test("bundleStageTitle — FAILED row shows the mapped on-chain reason", () => {
  const reason = failureReason({ code: "SOROBAN_1010", source: "onchain" });
  assertEquals(
    bundleStageTitle("failed", reason),
    "Failed — On-chain: the authorization signature expired before it was submitted.",
  );
  // Failed but reason not yet loaded → plain stage.
  assertEquals(bundleStageTitle("failed", null), "Failed");
  // Non-failed stages → capitalized stage, no reason.
  assertEquals(bundleStageTitle("completed", null), "Completed");
  assertEquals(bundleStageTitle("submitting", "ignored"), "Submitting");
});

Deno.test("platformError — non-JSON body falls back to the context message", async () => {
  const res = new Response("<html>502 Bad Gateway</html>", { status: 502 });
  const err = await platformError(res, "Failed to list providers.");
  assertEquals(err.message, "Failed to list providers.");
  assertEquals(err.code, undefined);
  assertEquals(err.status, 502);
});
