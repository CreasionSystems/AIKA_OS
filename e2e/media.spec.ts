import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * メディアタブの最小 E2E: タブ -> 画像ジョブ投入 -> 自動ポーリングで完了 + 生成物表示。
 * main は DummyInferenceAdapter を結線しており、/var/lib/aika/artifacts/... を返す。
 */
test("media: タブ -> 投入 -> 自動ポーリングで完了 + 生成物", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "メディア" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "メディア" })).toBeVisible();

  await page.getByLabel("プロンプト").fill("a cat");
  await page.getByRole("button", { name: "画像ジョブを投入" }).click();
  await expect(page.getByText(/ジョブID:/)).toBeVisible({ timeout: 15_000 });

  // 自動ポーリングで完了まで進む (手動更新は不要)。
  await expect(page.getByText("完了しました")).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/\/var\/lib\/aika\/artifacts\//),
  ).toBeVisible();

  await app.close();
});
