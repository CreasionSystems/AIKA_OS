import { readFile } from "node:fs/promises";
import { test, expect } from "./fixtures";

/**
 * 設定の読み込み失敗 E2E (#31 / #32)。
 *
 * ユニットテストは window.aika を差し替えるため IPC 境界も main の起動処理も
 * 通らない。ここでは実アプリを起動して確認する。
 *
 * 破損した設定は launchApp の settings で隔離ディレクトリに仕込む
 * (fixtures.ts)。実ユーザーデータには一切触れない。
 */

test("settings(load): 設定ファイルが壊れていてもウィンドウが開く", async ({ launchApp }) => {
  // 以前はここで main の await settingsService.load() が未処理の reject になり、
  // createMainWindow() へ到達せずウィンドウが一度も開かなかった。
  const { app } = await launchApp({ settings: '{ "theme": "dark", ' });
  const page = await app.firstWindow();

  await expect(page.getByRole("heading", { name: "文章作成" })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(page.getByText("設定ファイルの内容が壊れています。")).toBeVisible(
    { timeout: 15_000 },
  );
  // 読めていない設定の上に新しい値を書く操作を出さない。
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "再読み込み" })).toBeVisible();

  await app.close();
});

test("settings(load): 壊れた設定は保存操作なしに上書きされない", async ({ launchApp }) => {
  const broken = '{ "theme": "dark", ';
  const { app, settingsFile } = await launchApp({ settings: broken });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: "再読み込み" }).click();
  await expect(page.getByText("設定ファイルの内容が壊れています。")).toBeVisible(
    { timeout: 15_000 },
  );

  await app.close();
  // 元の内容がそのまま残っている。
  expect(await readFile(settingsFile, "utf-8")).toBe(broken);
});

test("settings(load): 値が壊れていれば既定値で開いたことを示す", async ({ launchApp }) => {
  // JSON としては読めるが値が不正。以前は無言で既定値化され、次回保存で
  // 元の内容が失われていた。
  const { app } = await launchApp({
    settings: JSON.stringify({ theme: "neon", jobHistoryLimit: -5 }),
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(
    page.getByRole("region", { name: "既定値で開いた項目" }),
  ).toBeVisible({ timeout: 15_000 });
  // 通常の「保存」ではなく、上書きになることが分かるラベルになる。
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "既定値で復旧して保存" }),
  ).toBeVisible();

  await app.close();
});

test("settings(load): 確認操作前は通常保存できず、確認操作後は保存できる", async ({ launchApp }) => {
  // JSON としては読めるが値が不正。既定値で開いた状態になる。
  const original = JSON.stringify({ theme: "neon", jobHistoryLimit: -5 });
  const { app, settingsFile } = await launchApp({ settings: original });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(
    page.getByRole("region", { name: "既定値で開いた項目" }),
  ).toBeVisible({ timeout: 15_000 });

  // UI を経由せず直接呼んでも、明示の復旧なしでは上書きできない。
  const direct = await page.evaluate(() =>
    window.aika.saveSettings({ theme: "dark" }),
  );
  expect(direct.status).toBe("failed");
  expect(await readFile(settingsFile, "utf-8")).toBe(original);

  // 明示の復旧操作を経た保存だけが通る。
  await page.getByRole("button", { name: "既定値で復旧して保存" }).click();
  await expect(
    page.getByRole("status", { name: "保存の状態" }),
  ).toContainText("保存しました", { timeout: 15_000 });

  await app.close();
  expect(await readFile(settingsFile, "utf-8")).not.toBe(original);
});
