import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { MediaPanel } from "./MediaPanel";
import { AppShell } from "./AppShell";
import i18n from "../i18n";
import { DEFAULT_SETTINGS } from "@shared/settings/settings";
import type { AikaApi } from "@shared/ipc/contract";

/**
 * i18n 切替の契約テスト。
 *
 * 固定する契約:
 *  - 既定は日本語 (既存テストが依存)。
 *  - 言語選択を en にすると Settings / Media / ナビの文言が英語になる。
 *  - status / alert も選択言語で出る。
 * 文言長が伸びても崩れない設計 (固定幅前提を避ける) の確認は E2E 側。
 */
function installAikaMock() {
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
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

describe("SettingsPanel 言語選択", () => {
  it("現在の言語 (system) を読み込み、選択肢を表示する", async () => {
    render(<SettingsPanel />);
    const select = await screen.findByLabelText("表示言語");
    expect(select).toHaveValue("system");
    // system / ja / en の 3 択。
    expect(
      screen.getByRole("option", { name: "システム設定に従う" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "日本語" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
  });

  it("English を選ぶと UI 文言が英語になり、保存前でも即時反映される", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await screen.findByLabelText("表示言語");

    await user.selectOptions(screen.getByLabelText("表示言語"), "en");

    // ラベル / ボタン / status が英語に切り替わる。
    await waitFor(() =>
      expect(screen.getByLabelText("Language")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Theme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Not saved");
  });
});

describe("MediaPanel 言語切替", () => {
  it("en 選択時は主要ボタン / status が英語になる", async () => {
    await i18n.changeLanguage("en");
    render(<MediaPanel />);

    expect(
      screen.getByRole("button", { name: "Submit image job" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh status" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Not submitted");
  });

  it("ja (既定) 時は日本語のまま", () => {
    render(<MediaPanel />);
    expect(
      screen.getByRole("button", { name: "画像ジョブを投入" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("未投入");
  });
});

describe("AppShell ナビ 言語切替", () => {
  it("en 選択時はタブラベルが英語になる", async () => {
    await i18n.changeLanguage("en");
    render(<AppShell />);
    for (const name of ["Writing", "Settings", "Updates", "Coding", "Media"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("tablist", { name: "Main navigation" }),
    ).toBeInTheDocument();
  });
});
