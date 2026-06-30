import { defineConfig } from "@playwright/test";

/**
 * Electron E2E 用 Playwright 設定。
 * ブラウザは起動せず、_electron でアプリを直接起動する。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 60_000,
});
