import { test, expect } from "./fixtures";

/**
 * 設定の最小 E2E: window.aika 越しに getSettings / saveSettings の往復が
 * 実 FileSettingsStore (userData) で通ること。
 */
test("settings: getSettings -> saveSettings -> getSettings 往復", async ({ launchApp }) => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  // シェルの設定タブへ切り替えてからパネルを確認する。
  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
    timeout: 15_000,
  });

  // 戻り値は結果ユニオンのため、成功分岐を確かめてから設定を取る。
  const saved = await page.evaluate(() =>
    window.aika
      .saveSettings({ theme: "dark" })
      .then((r) => (r.status === "succeeded" ? r.result : null)),
  );
  expect(saved?.theme).toBe("dark");

  // 戻り値は結果ユニオンのため、読み込めたことを確かめてから設定を取る。
  const reloaded = await page.evaluate(() =>
    window.aika
      .getSettings()
      .then((r) => (r.status === "unavailable" ? null : r.settings)),
  );
  expect(reloaded?.theme).toBe("dark");

  await app.close();
});

/**
 * 設定の検証エラー E2E。
 *
 * ユニットテストは window.aika を差し替えるため IPC 境界を越えず、この経路の
 * 欠陥を構造的に検出できない。ここでは実アプリを起動し、明細が structured
 * clone を越えて renderer まで届くことを確認する。
 *
 * 数値欄を空にすると valueAsNumber が NaN になり、main の validateSettings が
 * INVALID_JOB_HISTORY_LIMIT を返すため、テスト専用の注入口なしで到達できる。
 */
test("settings: 数値欄を空にして保存 -> ローカライズ済みの入力エラー", async ({ launchApp }) => {
  const { app } = await launchApp();
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await page.getByLabel("ジョブ履歴の上限").fill("");
  await page.getByRole("button", { name: "保存" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "ジョブ履歴の上限は 1 以上の整数にしてください。",
    { timeout: 15_000 },
  );

  // 内部情報が利用者に出ない。throw 経路では Electron が channel 名を
  // メッセージに埋め込むため、その退行を直接固定する。
  await expect(alert).not.toContainText("Error invoking remote method");
  await expect(alert).not.toContainText("aika:settings:");
  await expect(alert).not.toContainText("SettingsValidationError");

  // 短い状態サマリーにエラー本文を混ぜない (a11y 契約)。
  // 読み込み状態の region が増えたため、保存状態を名前で特定する。
  await expect(
    page.getByRole("status", { name: "保存の状態" }),
  ).not.toContainText("ジョブ履歴の上限は");

  await app.close();
});
