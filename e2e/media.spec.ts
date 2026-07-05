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
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
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
    page.getByText(/\/var\/lib\/aika\/artifacts\//).first(),
  ).toBeVisible();

  // 完了後にジョブ履歴へ記録され表示される。
  await expect(
    page.getByRole("list", { name: "ジョブ履歴" }),
  ).toBeVisible({ timeout: 15_000 });

  // 履歴をクリアすると一覧が消える。
  await page.getByRole("button", { name: "履歴をクリア" }).click();
  await expect(
    page.getByRole("list", { name: "ジョブ履歴" }),
  ).toBeHidden({ timeout: 15_000 });

  await app.close();
});

test("media(video): 種別 t2v -> 投入 -> 自動完了 + 動画生成物", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "メディア" }).click({ timeout: 15_000 });
  await page.getByLabel("種別").selectOption("t2v");
  await page.getByLabel("プロンプト").fill("a dog runs");
  await page.getByRole("button", { name: "動画ジョブを投入" }).click();

  await expect(page.getByText("完了しました")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("種別: t2v")).toBeVisible();
  await expect(page.getByText(/\.mp4/).first()).toBeVisible();

  await app.close();
});

test("media(video): i2v は元画像入力 -> 投入 -> 自動完了", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "メディア" }).click({ timeout: 15_000 });
  await page.getByLabel("種別").selectOption("i2v");
  await page.getByLabel("プロンプト").fill("make it move");
  await page.getByLabel("元画像のパス").fill("/abs/in.png");
  await page.getByRole("button", { name: "動画ジョブを投入" }).click();

  await expect(page.getByText("完了しました")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("種別: i2v")).toBeVisible();

  await app.close();
});
