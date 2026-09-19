import { test, expect } from "./fixtures";

/**
 * 文章作成の検証エラー E2E (Issue #24)。
 *
 * ユニットテストは window.aika を差し替えるため IPC 境界を越えず、この経路の
 * 欠陥を構造的に検出できない。ここでは実アプリを起動し、明細が structured
 * clone を越えて renderer まで届くことを確認する。
 *
 * 空プロンプトで送信すると main の validateWritingRequest が EMPTY_PROMPT を
 * 返すため、テスト専用の注入口なしで到達できる。
 */
test("writing: 空プロンプトで送信 -> ローカライズ済みの入力エラー", async ({ launchApp }) => {
  const { app } = await launchApp();
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "文章作成" }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: "生成" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("プロンプトを入力してください。", {
    timeout: 15_000,
  });

  // 内部情報が利用者に出ない。throw 経路では Electron が channel 名を
  // メッセージに埋め込むため、その退行を直接固定する。
  await expect(alert).not.toContainText("Error invoking remote method");
  await expect(alert).not.toContainText("aika:inference:");
  await expect(alert).not.toContainText("WritingValidationError");

  // 短い状態サマリーにエラー本文を混ぜない (a11y 契約)。
  await expect(page.getByRole("status")).not.toContainText(
    "プロンプトを入力してください",
  );

  await app.close();
});
