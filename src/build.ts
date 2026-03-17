/**
 * Bundles src/app.ts into public/app.js for the browser.
 * Uses esbuild via Deno with the denoPlugins for import map resolution.
 */
import * as esbuild from "https://deno.land/x/esbuild@v0.20.1/mod.js";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.10";

const isProduction = Deno.args.includes("--production");

await esbuild.build({
  entryPoints: ["src/app.ts"],
  bundle: true,
  outfile: "public/app.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: isProduction,
  sourcemap: !isProduction,
  plugins: [...denoPlugins({ configPath: `${Deno.cwd()}/deno.json` })],
});

esbuild.stop();
console.log(`Built public/app.js${isProduction ? " (production)" : ""}`);
