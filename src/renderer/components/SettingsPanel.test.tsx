import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import {
  DEFAULT_SETTINGS,
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
        status: "succeeded" as const,
        result: { ...DEFAULT_SETTINGS, ...patch },
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
        mediaPollIntervalMs: 1000,
        language: "system",
      }),
    });
    render(<SettingsPanel />);

    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("dark"),
    );
    expect(screen.getByLabelText("既定の文章モード")).toHaveValue("novel");
    expect(screen.getByLabelText("ジョブ履歴の上限")).toHaveValue(30);
    expect(screen.getByLabelText("メディア更新間隔（ms）")).toHaveValue(1000);
  });

  it("メディア更新間隔を編集して保存できる", async () => {
    const { saveSettings } = installAikaMock({});
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("メディア更新間隔（ms）")).toHaveValue(
        DEFAULT_SETTINGS.mediaPollIntervalMs,
      ),
    );

    const input = screen.getByLabelText("メディア更新間隔（ms）");
    await user.clear(input);
    await user.type(input, "2000");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ mediaPollIntervalMs: 2000 }),
      ),
    );
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
        mediaPollIntervalMs: DEFAULT_SETTINGS.mediaPollIntervalMs,
        language: DEFAULT_SETTINGS.language,
      }),
    );
    expect(await screen.findByText("保存しました")).toBeInTheDocument();
  });

  it("検証エラー時はエラーを表示する", async () => {
    installAikaMock({
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_THEME",
            messageKey: "settings.validation.invalidTheme",
            messageParams: { allowed: "light,dark,system" },
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "テーマは ライト / ダーク / システム のいずれかにしてください。",
    );
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
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_THEME",
            messageKey: "settings.validation.invalidTheme",
            messageParams: { allowed: "light,dark,system" },
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "テーマは ライト / ダーク / システム のいずれかにしてください。",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "テーマは ライト",
    );
  });
});

/**
 * 保存失敗は例外ではなく結果ユニオンで届く。
 *
 * 明細はロケール文字列を持たず messageKey / messageParams だけを運ぶため、
 * 表示文言はこの層で決まる。想定外の失敗では内部情報を出さない。
 */
describe("SettingsPanel (保存失敗の結果ユニオン)", () => {
  /** 読込完了を待ってから保存を押す。 */
  async function loadAndSave(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
  }

  it("補間なしの明細を i18n 済み文言で表示する", async () => {
    installAikaMock({
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_JOB_HISTORY_LIMIT",
            messageKey: "settings.validation.invalidJobHistoryLimit",
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await loadAndSave(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ジョブ履歴の上限は 1 以上の整数にしてください。",
    );
  });

  it("数値の補間値を展開する", async () => {
    installAikaMock({
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_POLL_INTERVAL",
            messageKey: "settings.validation.invalidPollInterval",
            messageParams: { min: 100, max: 60000 },
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await loadAndSave(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "メディア更新間隔は 100〜60000 の整数にしてください。",
    );
  });

  it("許容値一覧は翻訳済みの選択肢ラベルで出す", async () => {
    installAikaMock({
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_LANGUAGE",
            messageKey: "settings.validation.invalidLanguage",
            messageParams: { allowed: "system,ja,en" },
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await loadAndSave(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("システム設定に従う / 日本語 / English");
    // コード値がそのまま出ない。
    expect(alert).not.toHaveTextContent("system,ja,en");
  });

  it("モード名は翻訳してから差し込む", async () => {
    installAikaMock({
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_WRITING_MODE",
            messageKey: "settings.validation.invalidWritingMode",
            messageParams: { mode: "business" },
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await loadAndSave(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("仕事の書類");
    expect(alert).not.toHaveTextContent("business");
  });

  it("複数の明細は既存どおり \" / \" で連結する", async () => {
    installAikaMock({
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_JOB_HISTORY_LIMIT",
            messageKey: "settings.validation.invalidJobHistoryLimit",
          },
          {
            code: "INVALID_POLL_INTERVAL",
            messageKey: "settings.validation.invalidPollInterval",
            messageParams: { min: 100, max: 60000 },
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await loadAndSave(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ジョブ履歴の上限は 1 以上の整数にしてください。 / メディア更新間隔は 100〜60000 の整数にしてください。",
    );
  });

  it("failed は内部情報を含まない一般エラーを表示する", async () => {
    installAikaMock({
      saveSettings: async () => ({
        status: "failed",
        messageKey: "settings.error.saveFailed",
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await loadAndSave(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("設定を保存できませんでした。");
    expect(alert).not.toHaveTextContent("aika:settings:");
    expect(alert).not.toHaveTextContent("Error invoking remote method");
  });

  it("IPC 自体が reject しても、生の例外本文を表示しない", async () => {
    installAikaMock({
      saveSettings: async () => {
        throw new Error(
          "Error invoking remote method 'aika:settings:save': boom",
        );
      },
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await loadAndSave(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("設定を保存できませんでした。");
    expect(alert).not.toHaveTextContent("aika:settings:");
    expect(alert).not.toHaveTextContent("boom");
  });

  it("失敗しても編集中の値を保持し、直して再保存できる", async () => {
    const { saveSettings } = installAikaMock({
      saveSettings: async () => ({
        status: "invalid",
        issues: [
          {
            code: "INVALID_JOB_HISTORY_LIMIT",
            messageKey: "settings.validation.invalidJobHistoryLimit",
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("テーマ")).toHaveValue("system"),
    );
    await user.selectOptions(screen.getByLabelText("テーマ"), "dark");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("alert");

    // 入力は保持され、フォームも残る。
    expect(screen.getByLabelText("テーマ")).toHaveValue("dark");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    // alert は1つだけで、status に本文を混ぜない。
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("status")).not.toHaveTextContent("ジョブ履歴");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));
  });
});
