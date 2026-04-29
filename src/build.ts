/**
 * Bundles src/app.ts into public/app.js for the browser.
 * Uses esbuild via Deno with the denoPlugins for import map resolution.
 */
// deno-lint-ignore no-import-prefix -- build script intentionally pins the URL
import * as esbuild from "https://deno.land/x/esbuild@v0.20.1/mod.js";
// deno-lint-ignore no-import-prefix -- build script intentionally pins the version
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.10";

const isProduction = Deno.args.includes("--production");
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const version = denoJson.version ?? "0.0.0";

await esbuild.build({
  entryPoints: ["src/app.ts"],
  bundle: true,
  outfile: "public/app.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: isProduction,
  sourcemap: !isProduction,
  define: {
    "__APP_VERSION__": JSON.stringify(version),
    "__DEV_MODE__": JSON.stringify(!isProduction),
  },
  inject: ["src/shims/buffer.ts"],
  plugins: [...denoPlugins({ configPath: `${Deno.cwd()}/deno.json` })],
});

// Patch: the wallets kit has transitive deps that use CJS require("buffer") and
// ESM import "buffer", which esbuild can't resolve through the Deno plugin.
// Fix both by: 1) patching __require to return our polyfill for "buffer",
// 2) removing the bare ESM import.
let appJs = await Deno.readTextFile("public/app.js");
const before = appJs;

// Patch __require: intercept require("buffer") before it throws
appJs = appJs.replace(
  /throw\s*(Error\('Dynamic require of "'\s*\+\s*(\w+)\s*\+\s*'" is not supported'\))/,
  (_match, errExpr, varName) =>
    `if(${varName}==="buffer")return globalThis.__buffer_polyfill;throw ${errExpr}`,
);

if (appJs === before) {
  esbuild.stop();
  throw new Error(
    "Build failed: could not patch __require for buffer polyfill. " +
      "esbuild's CJS shim format may have changed.",
  );
}

// Remove ESM buffer imports — both bare ("buffer") and node-prefixed ("node:buffer").
// The shim at src/shims/buffer.ts is injected as a global, so any surviving
// import would attempt a network fetch and trip the browser CSP.
appJs = appJs.replace(
  /import\s*\{[^}]*\}\s*from\s*"(?:node:)?buffer"\s*;?/g,
  "",
);

// Defense in depth: any surviving `node:` specifier will be blocked by the
// browser CSP at runtime. Fail the build instead.
const surviving = appJs.match(/from\s*"node:[^"]+"/g);
if (surviving) {
  esbuild.stop();
  throw new Error(
    `Build failed: bundle contains node: specifiers that the browser cannot resolve:\n` +
      `  ${surviving.join("\n  ")}\n` +
      `Either extend the strip regex above, or remove the source-level import.`,
  );
}

await Deno.writeTextFile("public/app.js", appJs);

esbuild.stop();
console.log(`Built public/app.js${isProduction ? " (production)" : ""}`);
