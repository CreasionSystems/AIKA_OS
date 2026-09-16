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

test("media(video): 自由指示 -> 補足質問 -> 最終確認 -> 送信 (t2v)", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "メディア" }).click({ timeout: 15_000 });
  await page.getByLabel("種別").selectOption("t2v");

  // 曖昧な自由指示 -> まとめる -> 補足質問が出る
  await page.getByLabel("作りたい動画の内容").fill("犬");
  await page.getByRole("button", { name: "内容をまとめる" }).click();
  await expect(
    page.getByText("主題は何ですか？（被写体・場面）"),
  ).toBeVisible({ timeout: 15_000 });

  // 補足に答えて続ける -> 最終プロンプト案を確認 -> 送信
  await page
    .getByLabel("主題は何ですか？（被写体・場面）")
    .fill("夜の街を走る車をシネマティックに");
  await page.getByRole("button", { name: "続ける" }).click();
  await expect(page.getByLabel("最終プロンプト案（編集できます）")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "この内容で送信" }).click();

  // 送信後、ジョブが完了し動画生成物 + 種別が表示される
  await expect(page.getByText("送信しました")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("種別: t2v")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/\.mp4/).first()).toBeVisible();

  await app.close();
});

test("media(video): i2v は十分な指示 + 元画像入力 -> 送信 -> 自動完了", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "メディア" }).click({ timeout: 15_000 });
  await page.getByLabel("種別").selectOption("i2v");
  await page
    .getByLabel("作りたい動画の内容")
    .fill("静止画を動かしてゆっくりズーム");
  await page.getByRole("button", { name: "内容をまとめる" }).click();

  // ready で元画像欄が出る -> 入力 -> 送信
  await page.getByLabel("元画像のパス").fill("/abs/in.png");
  await page.getByRole("button", { name: "この内容で送信" }).click();

  await expect(page.getByText("送信しました")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("種別: i2v")).toBeVisible({ timeout: 15_000 });

  await app.close();
});

/**
 * Step 41-1: 実 Chromium 上でのキーボード操作。
 *
 * OS の日本語 IME (変換確定 Enter) は Playwright / CDP からは安定して
 * 再現できないため、ここでは通常 Enter と Shift+Enter の契約だけを見る。
 * IME ガード自体は composerKeyboard.test.tsx のユニットテストで固定している。
 */
test("media(video): 指示入力の Enter で送信、Shift+Enter は改行", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "メディア" }).click({ timeout: 15_000 });
  await page.getByLabel("種別").selectOption("t2v");

  const instruction = page.getByLabel("作りたい動画の内容");

  // Shift+Enter は送信せず改行を入れる (最終案は出ない)
  await instruction.fill("夜の街を走る車をシネマティックに");
  await instruction.press("Shift+Enter");
  await expect(instruction).toHaveValue("夜の街を走る車をシネマティックに\n");
  await expect(
    page.getByLabel("最終プロンプト案（編集できます）"),
  ).toBeHidden();

  // Enter は送信 (ボタンを押さずに ready へ進む)
  await instruction.press("Enter");
  await expect(page.getByLabel("最終プロンプト案（編集できます）")).toBeVisible({
    timeout: 15_000,
  });

  // 最終案でも Enter で送信できる
  await page.getByLabel("最終プロンプト案（編集できます）").press("Enter");
  await expect(page.getByText("送信しました")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("種別: t2v")).toBeVisible({ timeout: 15_000 });

  await app.close();
});
