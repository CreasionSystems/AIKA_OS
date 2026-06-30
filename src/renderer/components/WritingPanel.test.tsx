import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WritingPanel } from "./WritingPanel";
import { WritingValidationError } from "@shared/writing/writingModes";
import type { AikaApi } from "@shared/ipc/contract";
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

const okResult: TextGenerationResult = {
  text: "生成された文章です",
  finishReason: "stop",
  model: "dummy",
  usage: { promptTokens: 1, completionTokens: 1 },
};

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
    let resolve!: (r: TextGenerationResult) => void;
    installAikaMock(
      () => new Promise<TextGenerationResult>((res) => (resolve = res)),
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
    installAikaMock(async () => {
      throw new WritingValidationError([
        { code: "EMPTY_PROMPT", message: "プロンプトが空です。" },
      ]);
    });
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
