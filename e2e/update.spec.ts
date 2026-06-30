import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * 更新タブの最小 E2E: タブ切替 -> 確認 -> 状態表示。
 * main は Fake チェッカ (最新) を結線しているため up-to-date を表示する。
 */
test("update: タブ -> 確認 -> 最新表示", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "更新" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "更新" })).toBeVisible();

  await page.getByRole("button", { name: "更新を確認" }).click();
  await expect(page.getByText("最新です")).toBeVisible({ timeout: 15_000 });

  await app.close();
});
