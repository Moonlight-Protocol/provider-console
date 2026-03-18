/**
 * Bundles src/app.ts into public/app.js for the browser.
 * Uses esbuild via Deno with the denoPlugins for import map resolution.
 */
import * as esbuild from "https://deno.land/x/esbuild@v0.20.1/mod.js";
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
  define: { "__APP_VERSION__": JSON.stringify(version) },
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
  /throw (Error\('Dynamic require of "' \+ (\w+) \+ '" is not supported'\))/,
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

// Remove bare ESM buffer imports
appJs = appJs.replace(
  /import \{ Buffer as Buffer\d* \} from "buffer";/g,
  "",
);
await Deno.writeTextFile("public/app.js", appJs);

esbuild.stop();
console.log(`Built public/app.js${isProduction ? " (production)" : ""}`);
