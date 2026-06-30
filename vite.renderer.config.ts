import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * renderer (React) 専用の Vite ビルド設定。
 * base: "./" で file:// 読み込みに対応し、dist/renderer へ出力する。
 */
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@main": r("./src/main"),
      "@preload": r("./src/preload"),
      "@renderer": r("./src/renderer"),
      "@shared": r("./src/shared"),
    },
  },
  build: {
    outDir: r("./dist/renderer"),
    emptyOutDir: true,
  },
});
