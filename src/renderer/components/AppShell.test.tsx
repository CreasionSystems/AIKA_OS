import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { DEFAULT_SETTINGS } from "@shared/settings/settings";
import type { AikaApi } from "@shared/ipc/contract";
import type { TextGenerationResult } from "@shared/inference/port";

/**
 * 画面シェル/ナビの契約テスト。
 *
 * 固定する契約:
 *  - 文章作成 / 設定 / 更新 / コーディング のタブを持つ
 *  - 既定は文章作成、タブ切替で表示が入れ替わる (非アクティブは非表示)
 *  - 既存の文章作成・設定がシェル上で退行なく動く
 */

const okResult: TextGenerationResult = {
  text: "生成結果テキスト",
  finishReason: "stop",
  model: "dummy",
  usage: { promptTokens: 1, completionTokens: 1 },
};

function installAikaMock() {
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(async () => okResult),
    submitImageJob: vi.fn(),
    submitVideoJob: vi.fn(),
    getJob: vi.fn(),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (patch) => ({ ...DEFAULT_SETTINGS, ...patch })),
    listJobs: vi.fn(async () => []),
    clearJobs: vi.fn(async () => {}),
  } as unknown as AikaApi;
}

beforeEach(() => installAikaMock());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ナビ構造", () => {
  it("5つのタブを持つ", () => {
    render(<AppShell />);
    for (const name of ["文章作成", "設定", "更新", "コーディング", "メディア"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("既定は文章作成タブで、他画面は表示されない", () => {
    render(<AppShell />);
    expect(
      screen.getByRole("heading", { name: "文章作成" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "設定" }),
    ).not.toBeInTheDocument();
  });

  it("タブ切替で各画面が表示される", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByRole("tab", { name: "設定" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "設定" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "文章作成" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "更新" }));
    expect(screen.getByRole("heading", { name: "更新" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "コーディング" }));
    expect(
      screen.getByRole("heading", { name: "コーディング" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "メディア" }));
    expect(
      screen.getByRole("heading", { name: "メディア" }),
    ).toBeInTheDocument();
  });
});

describe("タブのキーボード操作 (ARIA)", () => {
  it("roving tabindex: アクティブのみ tabindex=0、他は -1", () => {
    render(<AppShell />);
    expect(screen.getByRole("tab", { name: "文章作成" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "設定" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("aria-controls と tabpanel が整合する", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    const writingTab = screen.getByRole("tab", { name: "文章作成" });
    expect(writingTab).toHaveAttribute("aria-controls", "panel-writing");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "panel-writing");
    expect(panel).toHaveAttribute("aria-labelledby", "tab-writing");

    await user.click(screen.getByRole("tab", { name: "設定" }));
    const panel2 = screen.getByRole("tabpanel");
    expect(panel2).toHaveAttribute("id", "panel-settings");
    expect(panel2).toHaveAttribute("aria-labelledby", "tab-settings");
  });

  it("ArrowRight で次タブを選択しフォーカスする", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    const writingTab = screen.getByRole("tab", { name: "文章作成" });
    writingTab.focus();
    await user.keyboard("{ArrowRight}");

    const settingsTab = screen.getByRole("tab", { name: "設定" });
    expect(settingsTab).toHaveAttribute("aria-selected", "true");
    expect(settingsTab).toHaveFocus();
    expect(settingsTab).toHaveAttribute("tabindex", "0");
    expect(writingTab).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowLeft は先頭から末尾へ循環する", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    screen.getByRole("tab", { name: "文章作成" }).focus();
    await user.keyboard("{ArrowLeft}");

    const lastTab = screen.getByRole("tab", { name: "メディア" });
    expect(lastTab).toHaveAttribute("aria-selected", "true");
    expect(lastTab).toHaveFocus();
  });

  it("Home / End で先頭・末尾へ移動する", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    screen.getByRole("tab", { name: "文章作成" }).focus();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "メディア" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "文章作成" })).toHaveFocus();
  });
});

describe("シェル上での既存機能の退行確認", () => {
  it("文章作成: 入力 -> 実行 -> 結果表示が動く", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.type(screen.getByLabelText("プロンプト"), "テーマ");
    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByText("生成結果テキスト")).toBeInTheDocument();
  });

  it("設定: 現在値が読み込まれて表示される", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByRole("tab", { name: "設定" }));
    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue(
        DEFAULT_SETTINGS.theme,
      ),
    );
  });
});
