import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * 最初の E2E スモーク:
 *  1. Electron が起動できる
 *  2. 最初のウィンドウが開く
 *  3. window.aika 経由で generateText が1回通る
 */
test("smoke: 起動 -> 最初のウィンドウ -> window.aika.generateText", async () => {
  // Linux/コンテナでは xvfb 配下で実行する (e2e スクリプト参照)。
  // --no-sandbox は root 実行のため必須。
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu"],
  });

  // 1 & 2: 最初のウィンドウが開く
  const page = await app.firstWindow();
  expect(page).toBeTruthy();

  // preload による window.aika の公開を待つ
  await expect
    .poll(() => page.evaluate(() => typeof window.aika?.generateText), {
      timeout: 15_000,
    })
    .toBe("function");

  // 3: generateText が1回通る (Dummy は "[dummy:general] hi" を返す)
  const text = await page.evaluate(
    () =>
      window.aika
        .generateText({ mode: "general", prompt: "hi" })
        .then((r) => r.text),
  );
  expect(text).toContain("dummy:general");

  await app.close();
});
