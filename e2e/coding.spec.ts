import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(here, "..", "dist", "main", "index.cjs");

/**
 * コーディングタブの最小 E2E (plan 縦切り): タブ -> goal 入力 -> 計画作成 -> 計画表示。
 * main は DummyInferenceAdapter を結線しており "Plan for: <goal>" を返す。
 */
test("coding: タブ -> 目標入力 -> 計画作成 -> 計画表示", async () => {
  const app = await electron.launch({
    args: [mainEntry, "--no-sandbox", "--disable-gpu"],
  });
  const page = await app.firstWindow();

  await page.getByRole("tab", { name: "コーディング" }).click({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "コーディング" }),
  ).toBeVisible();

  await page.getByLabel("目標 (goal)").fill("add feature");
  await page.getByRole("button", { name: "計画を作成" }).click();

  await expect(page.getByText(/Plan for: add feature/)).toBeVisible({
    timeout: 15_000,
  });

  await app.close();
});
