import { test, expect } from "./fixtures";

/**
 * 最初の E2E スモーク:
 *  1. Electron が起動できる
 *  2. 最初のウィンドウが開く
 *  3. window.aika 経由で generateText が1回通る
 */
test("smoke: 起動 -> 最初のウィンドウ -> window.aika.generateText", async ({
  launchApp,
}) => {
  // 起動引数 (--no-sandbox など) と userData の隔離は fixtures.ts に集約した。
  // 画面の無い Linux では xvfb-run の下で実行する (CI の E2E ステップ参照)。
  const { app } = await launchApp();

  // 1 & 2: 最初のウィンドウが開く
  const page = await app.firstWindow();
  expect(page).toBeTruthy();

  // React UI がマウントされる (CSP 配下で bundle が読み込めること)
  await expect(page.getByRole("heading", { name: "文章作成" })).toBeVisible({
    timeout: 15_000,
  });

  // preload による window.aika の公開を待つ
  await expect
    .poll(() => page.evaluate(() => typeof window.aika?.generateText), {
      timeout: 15_000,
    })
    .toBe("function");

  // 3: generateText が1回通る (Dummy は "[dummy:general] hi" を返す)
  // 戻り値は結果ユニオンのため、成功分岐を確かめてから本文を取る (Issue #24)。
  const text = await page.evaluate(() =>
    window.aika
      .generateText({ mode: "general", prompt: "hi" })
      .then((r) => (r.status === "succeeded" ? r.result.text : null)),
  );
  expect(text).toContain("dummy:general");

  await app.close();
});
