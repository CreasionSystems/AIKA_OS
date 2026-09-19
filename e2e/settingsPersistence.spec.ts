import { chmod, readdir, readFile } from "node:fs/promises";
import { test, expect } from "./fixtures";

/**
 * 設定の保存の保全 E2E (#33)。
 *
 * 実アプリで UI から保存し、ディスク上の結果を確かめる。
 * userData は launchApp が隔離し、読取専用にしたファイルも含めて片付ける
 * (fixtures.ts)。実ユーザーデータには触れず、アプリ側にテスト専用の注入口・
 * 環境変数・IPC channel も追加していない。
 */

async function tempsIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((n) => n.startsWith("settings.json.") && n.endsWith(".tmp"));
}

test("settings(persist): 保存すると直前の内容が .bak に残り、一時ファイルは残らない", async ({ launchApp }) => {
  const original = JSON.stringify({ theme: "dark" });
  const { app, userDataDir, settingsFile } = await launchApp({ settings: original });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await page.getByLabel("テーマ").selectOption("light");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "保存の状態" }),
  ).toContainText("保存しました", { timeout: 15_000 });
  await app.close();

  expect(JSON.parse(await readFile(settingsFile, "utf-8")).theme).toBe("light");
  expect(await readFile(`${settingsFile}.bak`, "utf-8")).toBe(original);
  expect(await tempsIn(userDataDir)).toEqual([]);
});

test("settings(persist): 既定値で復旧して保存すると、壊れていた元の内容が .bak に残る", async ({ launchApp }) => {
  // #32 の復旧保存で失われる元の値を、1世代だけでも退避できていること。
  const broken = JSON.stringify({ theme: "neon", jobHistoryLimit: -5 });
  const { app, settingsFile } = await launchApp({ settings: broken });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await page
    .getByRole("button", { name: "既定値で復旧して保存" })
    .click({ timeout: 15_000 });
  await expect(
    page.getByRole("status", { name: "保存の状態" }),
  ).toContainText("保存しました", { timeout: 15_000 });
  await app.close();

  expect(await readFile(`${settingsFile}.bak`, "utf-8")).toBe(broken);
  expect(JSON.parse(await readFile(settingsFile, "utf-8")).theme).not.toBe(
    "neon",
  );
});

test("settings(persist): 読取専用の設定ファイルは上書きせず、内部情報なしで失敗を示す", async ({ launchApp }) => {
  const original = JSON.stringify({ theme: "dark" });
  const { app, userDataDir, settingsFile } = await launchApp({ settings: original });
  await chmod(settingsFile, 0o444);
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await page.getByLabel("テーマ").selectOption("light");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("設定を保存できませんでした。", {
    timeout: 15_000,
  });
  // パス・生の filesystem code・channel 名を利用者に出さない。
  await expect(alert).not.toContainText("EACCES");
  await expect(alert).not.toContainText("settings.json");
  await expect(alert).not.toContainText("aika:settings:");
  await app.close();

  // rename はディレクトリの権限しか見ないが、読取専用は従来どおり守られる。
  expect(await readFile(settingsFile, "utf-8")).toBe(original);
  expect(await tempsIn(userDataDir)).toEqual([]);
});
