import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import {
  DEFAULT_SETTINGS,
  SettingsValidationError,
  type AppSettings,
} from "@shared/settings/settings";
import type { AikaApi } from "@shared/ipc/contract";

/**
 * 設定画面の契約テスト (Testing Library / jsdom)。
 * 読込 -> 編集 -> 保存の往復を window.aika 越しに固定する。
 */
function installAikaMock(over: {
  getSettings?: AikaApi["getSettings"];
  saveSettings?: AikaApi["saveSettings"];
}) {
  const getSettings = vi.fn(over.getSettings ?? (async () => DEFAULT_SETTINGS));
  const saveSettings = vi.fn(
    over.saveSettings ??
      (async (patch: Partial<AppSettings>) => ({
        ...DEFAULT_SETTINGS,
        ...patch,
      })),
  );
  (window as unknown as { aika: AikaApi }).aika = {
    generateText: vi.fn(),
    submitImageJob: vi.fn(),
    submitVideoJob: vi.fn(),
    getJob: vi.fn(),
    getSettings,
    saveSettings,
  } as unknown as AikaApi;
  return { getSettings, saveSettings };
}

beforeEach(() => {
  delete (window as { aika?: unknown }).aika;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsPanel", () => {
  it("マウント時に現在の設定を読み込んで表示する", async () => {
    installAikaMock({
      getSettings: async () => ({
        defaultWritingMode: "novel",
        theme: "dark",
        jobHistoryLimit: 30,
      }),
    });
    render(<SettingsPanel />);

    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("dark"),
    );
    expect(screen.getByLabelText("既定の文章モード")).toHaveValue("novel");
    expect(screen.getByLabelText("ジョブ履歴の上限")).toHaveValue(30);
  });

  it("編集 -> 保存で saveSettings を呼び、保存完了を表示する", async () => {
    const { saveSettings } = installAikaMock({});
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );

    await user.selectOptions(screen.getByLabelText("テーマ"), "dark");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        defaultWritingMode: "general",
        theme: "dark",
        jobHistoryLimit: DEFAULT_SETTINGS.jobHistoryLimit,
      }),
    );
    expect(await screen.findByText("保存しました")).toBeInTheDocument();
  });

  it("検証エラー時はエラーを表示する", async () => {
    installAikaMock({
      saveSettings: async () => {
        throw new SettingsValidationError([
          { code: "INVALID_THEME", message: "theme が不正です。" },
        ]);
      },
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/theme/);
  });
});

describe("SettingsPanel (状態サマリー live region)", () => {
  it("サマリーは role=status / aria-live=polite / aria-atomic=true で読込後に存在する", async () => {
    installAikaMock({});
    render(<SettingsPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent("未保存");
  });

  it("保存後にサマリーが『保存しました』になる", async () => {
    installAikaMock({});
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("保存しました"),
    );
  });

  it("エラーは alert に出し、status には混ぜない", async () => {
    installAikaMock({
      saveSettings: async () => {
        throw new SettingsValidationError([
          { code: "INVALID_THEME", message: "theme が不正です。" },
        ]);
      },
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/theme/);
    expect(screen.getByRole("status")).not.toHaveTextContent("theme が不正です");
  });
});
