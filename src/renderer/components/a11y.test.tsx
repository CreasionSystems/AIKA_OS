import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { AppShell } from "./AppShell";
import { DEFAULT_SETTINGS } from "@shared/settings/settings";
import type { AikaApi } from "@shared/ipc/contract";

/**
 * a11y チェック (axe-core を直接実行)。各タブ画面に重大な違反がないことを固定する。
 *
 * html-has-lang / document-title は実 index.html (lang="ja" + <title>) で
 * 担保される文書レベルのルールのため、jsdom 環境では無効化する。
 * color-contrast はレイアウト依存で jsdom では評価できないため無効化する
 * (見た目のコントラストは将来 E2E / 実機側で担保)。
 */
function installAikaMock() {
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
    submitImageJob: vi.fn(),
    submitVideoJob: vi.fn(),
    getJob: vi.fn(),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(),
    checkUpdate: vi.fn(),
    planCode: vi.fn(),
    executeCode: vi.fn(),
    verifyCode: vi.fn(),
    rewindCode: vi.fn(),
    listJobs: vi.fn(async () => []),
    clearJobs: vi.fn(async () => {}),
  } as unknown as AikaApi;
}

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      "html-has-lang": { enabled: false },
      "document-title": { enabled: false },
      "color-contrast": { enabled: false },
    },
  });
  expect(results.violations).toEqual([]);
}

beforeEach(() => installAikaMock());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a11y: 各タブ画面に重大な違反がない", () => {
  it("文章作成タブ", async () => {
    const { container } = render(<AppShell />);
    await expectNoViolations(container);
  });

  it("設定タブ", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    await user.click(screen.getByRole("tab", { name: "設定" }));
    await screen.findByLabelText("テーマ");
    await expectNoViolations(container);
  });

  it("更新タブ", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    await user.click(screen.getByRole("tab", { name: "更新" }));
    await screen.findByRole("heading", { name: "更新" });
    await expectNoViolations(container);
  });

  it("コーディングタブ", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    await user.click(screen.getByRole("tab", { name: "コーディング" }));
    await screen.findByRole("heading", { name: "コーディング" });
    await expectNoViolations(container);
  });

  it("メディアタブ", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    await user.click(screen.getByRole("tab", { name: "メディア" }));
    await screen.findByRole("heading", { name: "メディア" });
    await expectNoViolations(container);
  });
});
