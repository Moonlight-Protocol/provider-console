/**
 * Simple static file server for the provider console.
 * Serves files from public/ directory with security headers and path sanitization.
 */
import { resolve, normalize } from "jsr:@std/path";

const PORT = Number(Deno.env.get("PORT") || "3000");
const PUBLIC_ROOT = resolve(Deno.cwd(), "public");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function getCSP(): string {
  const apiUrl = Deno.env.get("API_BASE_URL") || "http://localhost:8000";
  const posthogHost = Deno.env.get("POSTHOG_HOST") || "";
  const connectSrc = [apiUrl, posthogHost].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' https://us-assets.i.posthog.com",
    "style-src 'self' 'unsafe-hashes' 'unsafe-inline'",
    "img-src 'self' https://stellar.creit.tech",
    "frame-src https://*.grafana.net",
    `connect-src 'self' ${connectSrc}`,
  ].join("; ");
}

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Security-Policy", getCSP());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Resolves a URL pathname to a safe file path within PUBLIC_ROOT.
 * Returns null if the resolved path escapes the public directory.
 */
function safePath(pathname: string): string | null {
  // Decode and normalize to handle %2e%2e etc.
  const decoded = decodeURIComponent(pathname);
  const resolved = resolve(PUBLIC_ROOT, "." + normalize("/" + decoded));
  if (!resolved.startsWith(PUBLIC_ROOT)) return null;
  return resolved;
}

const contentTypes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";

  // Block source maps in production
  if (pathname.endsWith(".map")) {
    return addSecurityHeaders(new Response("Not Found", { status: 404 }));
  }

  const filePath = safePath(pathname);
  if (!filePath) {
    return addSecurityHeaders(new Response("Forbidden", { status: 403 }));
  }

  try {
    const file = await Deno.readFile(filePath);
    const ext = filePath.split(".").pop() || "";
    // HTML: no cache. Assets: cache 1 hour.
    const cacheControl = ext === "html"
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=3600";
    return addSecurityHeaders(new Response(file, {
      headers: {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
      },
    }));
  } catch {
    // SPA fallback — only for paths that look like app routes (no file extension)
    const ext = pathname.split("/").pop()?.includes(".") ?? false;
    if (ext) {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
    try {
      const index = await Deno.readFile(resolve(PUBLIC_ROOT, "index.html"));
      return addSecurityHeaders(new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }));
    } catch {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
  }
});

console.log(`Provider Console running on http://localhost:${PORT}`);
