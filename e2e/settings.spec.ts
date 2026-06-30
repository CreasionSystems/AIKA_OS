import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * 設定の最小 E2E: window.aika 越しに getSettings / saveSettings の往復が
 * 実 FileSettingsStore (userData) で通ること。
 */
test("settings: getSettings -> saveSettings -> getSettings 往復", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu"],
  });
  const page = await app.firstWindow();
  // シェルの設定タブへ切り替えてからパネルを確認する。
  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
    timeout: 15_000,
  });

  const saved = await page.evaluate(() =>
    window.aika.saveSettings({ theme: "dark" }),
  );
  expect(saved.theme).toBe("dark");

  const reloaded = await page.evaluate(() => window.aika.getSettings());
  expect(reloaded.theme).toBe("dark");

  await app.close();
});
