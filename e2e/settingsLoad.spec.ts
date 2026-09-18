import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * 設定の読み込み失敗 E2E (#31 / #32)。
 *
 * ユニットテストは window.aika を差し替えるため IPC 境界も main の起動処理も
 * 通らない。ここでは実アプリを起動して確認する。
 *
 * 破損した設定を仕込むため --user-data-dir で隔離する。これは Chromium 標準の
 * スイッチで、アプリ側にテスト専用の注入口・環境変数・IPC channel は要らない。
 * 実ユーザーデータには一切触れない。
 */
async function launchWithSettings(body: string) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "aika-e2e-"));
  const settingsFile = path.join(userDataDir, "settings.json");
  await writeFile(settingsFile, body, "utf-8");
  const app = await electron.launch({
    args: [
      mainEntry,
      `--user-data-dir=${userDataDir}`,
      "--no-sandbox",
      "--disable-gpu",
      "--lang=ja",
    ],
  });
  return { app, settingsFile };
}

test("settings(load): 設定ファイルが壊れていてもウィンドウが開く", async () => {
  // 以前はここで main の await settingsService.load() が未処理の reject になり、
  // createMainWindow() へ到達せずウィンドウが一度も開かなかった。
  const { app } = await launchWithSettings('{ "theme": "dark", ');
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

test("settings(load): 壊れた設定は保存操作なしに上書きされない", async () => {
  const broken = '{ "theme": "dark", ';
  const { app, settingsFile } = await launchWithSettings(broken);
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

test("settings(load): 値が壊れていれば既定値で開いたことを示す", async () => {
  // JSON としては読めるが値が不正。以前は無言で既定値化され、次回保存で
  // 元の内容が失われていた。
  const { app } = await launchWithSettings(
    JSON.stringify({ theme: "neon", jobHistoryLimit: -5 }),
  );
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
