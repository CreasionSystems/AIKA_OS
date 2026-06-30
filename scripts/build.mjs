import * as esbuild from "esbuild";
import { build as viteBuild } from "vite";

/**
 * Electron の main / preload を CJS にバンドルし、renderer (React) を Vite でビルドする。
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

await viteBuild({ configFile: "vite.renderer.config.ts" });

console.log("build complete: dist/main, dist/preload, dist/renderer");
