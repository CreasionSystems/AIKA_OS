import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

/**
 * Electron の main / preload を CJS にバンドルし、renderer の静的資産を配置する。
 * tsconfig の paths (@main/@shared 等) は esbuild が解決する。
 */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  tsconfig: "tsconfig.json",
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: ["src/main/index.ts"],
  outfile: "dist/main/index.cjs",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/preload/index.cjs",
});

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer/index.html", "dist/renderer/index.html");

console.log("build complete: dist/main, dist/preload, dist/renderer");
