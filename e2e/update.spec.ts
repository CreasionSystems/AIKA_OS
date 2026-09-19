import { test, expect } from "./fixtures";

/**
 * 更新タブの最小 E2E: タブ切替 -> 確認 -> 状態表示。
 * main は Fake チェッカ (最新) を結線しているため up-to-date を表示する。
 */
test("update: タブ -> 確認 -> 最新表示", async ({ launchApp }) => {
  const { app } = await launchApp();
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "更新" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "更新" })).toBeVisible();

  await page.getByRole("button", { name: "更新を確認" }).click();
  await expect(page.getByText("最新です")).toBeVisible({ timeout: 15_000 });

  await app.close();
});
