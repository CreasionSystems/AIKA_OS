import { defineConfig } from "@playwright/test";

/**
 * Electron E2E 用 Playwright 設定。
 * ブラウザは起動せず、_electron でアプリを直接起動する (e2e/fixtures.ts)。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 60_000,
  // 成功したテストの出力は残さない。失敗したテストだけ、error-context.md と
  // 診断用に写した userData (fixtures.ts) を test-results/ に残す。
  preserveOutput: "failures-only",
});
