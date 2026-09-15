import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * i18n の最小 E2E: 設定で言語を English に切り替えると、ナビ / Media タブの
 * 文言が選択言語で表示されること (保存前でも即時反映)。
 *
 * 文言長の耐性: 英語ラベルは日本語より短いが、将来 French / CJK 等で 20-30%
 * 伸びても崩れないよう固定幅前提を避けている (レイアウトは flex ベース)。
 * ここでは切替が反映されることを主に固定する。
 */
test("i18n: 設定で言語切替 -> ナビ / Media が選択言語になる", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  // 既定は日本語。設定タブへ。
  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
    timeout: 15_000,
  });

  // 表示言語を English に切り替える (即時反映)。
  await page.getByLabel("表示言語").selectOption("en");

  // ナビのタブラベルが英語になる。
  await expect(page.getByRole("tab", { name: "Media" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible();

  // Media タブへ移動し、主要ボタンのラベルが選択言語であることを確認。
  await page.getByRole("tab", { name: "Media" }).click();
  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit image job" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh status" }),
  ).toBeVisible();

  await app.close();
});

/**
 * フランス語切替: 文言が最も伸びる言語で主要導線が表示され、
 * 動画種別ラベルも実訳されることを固定する。
 */
test("i18n: 設定で言語切替 -> French (動画種別も実訳)", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
    timeout: 15_000,
  });

  // 表示言語を Français に切り替える。
  await page.getByLabel("表示言語").selectOption("fr");

  // ナビ / Settings がフランス語 (英語より長い文言でも導線が保たれる)。
  await expect(page.getByRole("tab", { name: "Média" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Paramètres" }),
  ).toBeVisible();

  // Media タブの主要ボタンがフランス語。
  await page.getByRole("tab", { name: "Média" }).click();
  await expect(
    page.getByRole("button", { name: "Lancer la tâche d'image" }),
  ).toBeVisible();

  // 動画種別ラベルもフランス語で表示される (実訳済み)。
  await expect(
    page.getByRole("option", { name: "Vidéo : Text to Video" }),
  ).toBeAttached();

  await app.close();
});

/**
 * 全主要画面 (Writing / Update / Coding) の言語切替と主要操作 + status を
 * en と fr で確認する。fr は最も文言が伸びる言語での導線確認も兼ねる。
 * 計画手順数は DummyInferenceAdapter 固定の 3 手順 (plural: other)。
 */
async function walkPanels(
  lang: "en" | "fr",
  labels: {
    writingTab: string;
    prompt: string;
    generate: string;
    generated: string;
    updateTab: string;
    check: string;
    upToDate: string;
    codingTab: string;
    goal: string;
    plan: string;
    planned: string;
  },
) {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu", "--lang=ja"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "設定" }).click({ timeout: 15_000 });
  await page.getByLabel("表示言語").selectOption(lang);

  // Writing: 入力 -> 生成 -> status。
  await page.getByRole("tab", { name: labels.writingTab }).click();
  await page.getByLabel(labels.prompt).fill("hello");
  await page.getByRole("button", { name: labels.generate }).click();
  await expect(page.getByRole("status")).toContainText(labels.generated, {
    timeout: 15_000,
  });

  // Update: 確認 -> status (最新)。
  await page.getByRole("tab", { name: labels.updateTab }).click();
  await page.getByRole("button", { name: labels.check }).click();
  await expect(page.getByRole("status")).toContainText(labels.upToDate, {
    timeout: 15_000,
  });

  // Coding: goal 入力 -> 計画作成 -> status (件数は plural)。
  await page.getByRole("tab", { name: labels.codingTab }).click();
  await page.getByLabel(labels.goal).fill("add feature");
  await page.getByRole("button", { name: labels.plan }).click();
  await expect(page.getByRole("status")).toContainText(labels.planned, {
    timeout: 15_000,
  });

  await app.close();
}

test("i18n(en): Writing / Update / Coding の主要操作 + status", async () => {
  await walkPanels("en", {
    writingTab: "Writing",
    prompt: "Prompt",
    generate: "Generate",
    generated: "Generated",
    updateTab: "Updates",
    check: "Check for updates",
    upToDate: "Up to date",
    codingTab: "Coding",
    goal: "Goal",
    plan: "Create plan",
    planned: "Created a plan (3 steps)",
  });
});

test("i18n(fr): Writing / Update / Coding の主要操作 + status (文言伸長)", async () => {
  await walkPanels("fr", {
    writingTab: "Rédaction",
    prompt: "Invite",
    generate: "Générer",
    generated: "Généré",
    updateTab: "Mises à jour",
    check: "Rechercher des mises à jour",
    upToDate: "À jour",
    codingTab: "Codage",
    goal: "Objectif",
    plan: "Créer un plan",
    planned: "Plan créé (3 étapes)",
  });
});
