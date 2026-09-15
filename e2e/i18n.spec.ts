import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * i18n の最小 E2E: 設定で言語を English に切り替えると、ナビ / Media タブの
 * 文言が選択言語で表示されること (保存前でも即時反映)。
 *
 * 文言長の耐性: 英語ラベルは日本語より短いが、将来 French / CJK 等で 20-30%
 * 伸びても崩れないよう固定幅前提を避けている (レイアウトは flex ベース)。
 * ここでは切替が反映されることを主に固定する。
 */
test("i18n: 設定で言語切替 -> ナビ / Media が選択言語になる", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  // 既定は日本語。設定タブへ。
  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
    timeout: 15_000,
  });

  // 表示言語を English に切り替える (即時反映)。
  await page.getByLabel("表示言語").selectOption("en");

  // ナビのタブラベルが英語になる。
  await expect(page.getByRole("tab", { name: "Media" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible();

  // Media タブへ移動し、主要ボタンのラベルが選択言語であることを確認。
  await page.getByRole("tab", { name: "Media" }).click();
  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit image job" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh status" }),
  ).toBeVisible();

  await app.close();
});
