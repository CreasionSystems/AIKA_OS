import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@main": r("./src/main"),
      "@preload": r("./src/preload"),
      "@renderer": r("./src/renderer"),
      "@shared": r("./src/shared"),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // 実行環境は拡張子で分ける: .ts (main / shared / preload) は node、
    // .tsx (renderer) は jsdom。Vitest 4 で environmentMatchGlobs が廃止されたため
    // projects で表す。extends: true で上の plugins / alias / globals を引き継ぐ。
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});
