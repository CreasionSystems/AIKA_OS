import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WritingPanel } from "./WritingPanel";
import type { AikaApi, GenerateTextResult } from "@shared/ipc/contract";
import type { TextGenerationResult } from "@shared/inference/port";

/**
 * 文章作成 最小画面の契約テスト (Testing Library / jsdom)。
 *
 * 固定する契約: 入力 -> 実行 (window.aika.generateText) -> 結果表示。
 * window.aika をモックして UI フローを決定的に検証する。
 */

function installAikaMock(
  generateText: AikaApi["generateText"],
): { generateText: ReturnType<typeof vi.fn> } {
  const mock = {
    generateText: vi.fn(generateText),
    submitImageJob: vi.fn(),
    submitVideoJob: vi.fn(),
    getJob: vi.fn(),
  } as unknown as AikaApi & { generateText: ReturnType<typeof vi.fn> };
  (window as unknown as { aika: AikaApi }).aika = mock;
  return mock;
}

const okText: TextGenerationResult = {
  text: "生成された文章です",
  finishReason: "stop",
  model: "dummy",
  usage: { promptTokens: 1, completionTokens: 1 },
};

/** 成功の結果ユニオン (Issue #24)。 */
const okResult: GenerateTextResult = { status: "succeeded", result: okText };

beforeEach(() => {
  delete (window as { aika?: unknown }).aika;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WritingPanel", () => {
  it("入力 -> 実行 -> 結果表示", async () => {
    const mock = installAikaMock(async () => okResult);
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "桜について書いて");
    await user.selectOptions(screen.getByLabelText("モード"), "novel");
    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByText("生成された文章です")).toBeInTheDocument();
    expect(mock.generateText).toHaveBeenCalledWith({
      mode: "novel",
      prompt: "桜について書いて",
    });
  });

  it("実行中はボタンを無効化する", async () => {
    let resolve!: (r: GenerateTextResult) => void;
    installAikaMock(
      () => new Promise<GenerateTextResult>((res) => (resolve = res)),
    );
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /生成/ })).toBeDisabled(),
    );

    resolve(okResult);
    expect(await screen.findByText("生成された文章です")).toBeInTheDocument();
  });

  it("検証エラー時はエラーメッセージを表示し、結果は出さない", async () => {
    installAikaMock(async () => ({
      status: "invalid",
      issues: [
        {
          code: "EMPTY_PROMPT",
          messageKey: "writing.validation.emptyPrompt",
        },
      ],
    }));
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/プロンプト/);
    expect(screen.queryByText("生成された文章です")).not.toBeInTheDocument();
  });

  it("モード選択肢に5モードが揃う", () => {
    installAikaMock(async () => okResult);
    render(<WritingPanel />);
    const select = screen.getByLabelText("モード");
    expect(select).toContainHTML("一般");
    for (const label of ["小説", "歌詞", "仕事の書類", "法務文章"]) {
      expect(select).toContainHTML(label);
    }
  });
});

describe("WritingPanel (状態サマリー live region)", () => {
  it("サマリーは role=status / aria-live=polite / aria-atomic=true で初期から『未生成』", () => {
    installAikaMock(async () => okResult);
    render(<WritingPanel />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent("未生成");
  });

  it("生成後にサマリーが『生成しました』になり、本文は region 外", async () => {
    installAikaMock(async () => okResult);
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "生成" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("生成しました");
    expect(status).not.toHaveTextContent("生成された文章です");
    expect(screen.getByText("生成された文章です")).toBeInTheDocument();
  });

  it("エラーは alert に出し、status には混ぜない", async () => {
    installAikaMock(async () => ({
      status: "invalid",
      issues: [
        {
          code: "EMPTY_PROMPT",
          messageKey: "writing.validation.emptyPrompt",
        },
      ],
    }));
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "x");
    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/プロンプト/);
    expect(screen.getByRole("status")).not.toHaveTextContent("プロンプトが空です");
  });
});

/**
 * Issue #24: 失敗は例外ではなく結果ユニオンで届く。
 *
 * 明細はロケール文字列を持たず messageKey / messageParams だけを運ぶため、
 * 表示文言はこの層で決まる。想定外の失敗では内部情報を出さない。
 */
describe("WritingPanel (失敗の結果ユニオン)", () => {
  it("invalid の明細を i18n 済み文言で表示する", async () => {
    installAikaMock(async () => ({
      status: "invalid",
      issues: [
        { code: "EMPTY_PROMPT", messageKey: "writing.validation.emptyPrompt" },
      ],
    }));
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "プロンプトを入力してください。",
    );
  });

  it("補間値を伴う明細を展開し、モード名は翻訳してから差し込む", async () => {
    installAikaMock(async () => ({
      status: "invalid",
      issues: [
        {
          code: "TEMPERATURE_NOT_ALLOWED",
          messageKey: "writing.validation.temperatureNotAllowed",
          messageParams: { mode: "business", max: 0.6 },
        },
      ],
    }));
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    const alert = await screen.findByRole("alert");
    // "business" ではなく翻訳済みのモード名が出る。
    expect(alert).toHaveTextContent("仕事の書類 モードでは temperature は 0.6 以下");
    expect(alert).not.toHaveTextContent("business");
  });

  it("複数の明細は既存どおり \" / \" で連結する", async () => {
    installAikaMock(async () => ({
      status: "invalid",
      issues: [
        { code: "EMPTY_PROMPT", messageKey: "writing.validation.emptyPrompt" },
        {
          code: "INVALID_MAX_TOKENS",
          messageKey: "writing.validation.invalidMaxTokens",
        },
      ],
    }));
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "プロンプトを入力してください。 / maxTokens は 1 以上にしてください。",
    );
  });

  it("failed は内部情報を含まない一般エラーを表示する", async () => {
    installAikaMock(async () => ({
      status: "failed",
      messageKey: "writing.error.generationFailed",
    }));
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("生成できませんでした。");
    expect(alert).not.toHaveTextContent("aika:inference:");
    expect(alert).not.toHaveTextContent("Error invoking remote method");
  });

  it("IPC 自体が reject しても、生の例外本文を表示しない", async () => {
    installAikaMock(async () => {
      throw new Error(
        "Error invoking remote method 'aika:inference:generateText': boom",
      );
    });
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.click(screen.getByRole("button", { name: "生成" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("生成できませんでした。");
    expect(alert).not.toHaveTextContent("aika:inference:");
    expect(alert).not.toHaveTextContent("boom");
  });

  it("失敗しても入力を保持し、status に本文を混ぜない", async () => {
    installAikaMock(async () => ({
      status: "invalid",
      issues: [
        { code: "EMPTY_PROMPT", messageKey: "writing.validation.emptyPrompt" },
      ],
    }));
    const user = userEvent.setup();
    render(<WritingPanel />);

    await user.type(screen.getByLabelText("プロンプト"), "桜について");
    await user.click(screen.getByRole("button", { name: "生成" }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("プロンプト")).toHaveValue("桜について");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "プロンプトを入力してください",
    );
    // alert は1つだけ。
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
