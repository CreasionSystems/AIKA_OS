import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import type {
  PromptRefinementPort,
  RefineResult,
} from "@shared/media/promptRefinement";

/**
 * 会話ログ (role="log") と世代管理のコンポーネント回帰テスト。
 *
 * 表示は最小限 (領域 / 話者識別 / 本文) で、見た目のチャット化は後続 PR。
 */
const SUFFICIENT = "夕暮れの海辺を歩く犬をシネマティックに";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function readyRefine(): PromptRefinementPort {
  return {
    refine: async (): Promise<RefineResult> => ({
      status: "ready",
      draftPrompt: SUFFICIENT,
      summary: SUFFICIENT,
    }),
  };
}

function instructionArea(): HTMLTextAreaElement {
  return screen.getByLabelText("作りたい動画の内容") as HTMLTextAreaElement;
}

describe("会話ログの表示", () => {
  it("role=log の領域が初回レンダリングから存在する", () => {
    render(
      <VideoPromptComposer
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={readyRefine()}
      />,
    );
    const log = screen.getByRole("log");
    expect(log).toBeInTheDocument();
    expect(log).toHaveAttribute("aria-live", "polite");
    // 末尾への追加だけを読み上げ対象にする。
    expect(log).toHaveAttribute("aria-relevant", "additions");
  });

  it("指示を送るとユーザー発話が話者ラベル付きでログに現れる", async () => {
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={readyRefine()}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");

    const log = screen.getByRole("log");
    await waitFor(() =>
      expect(within(log).getByText(SUFFICIENT)).toBeInTheDocument(),
    );
    expect(within(log).getByText(/ユーザー/)).toBeInTheDocument();
    // アシスタントの発話は i18n キー経由で表示する。
    expect(within(log).getByText(/アシスタント/)).toBeInTheDocument();
    expect(
      within(log).getByText("プロンプト案を提示しました"),
    ).toBeInTheDocument();
  });

  it("送信状態の status とコピー結果の status はログと別に保たれる", async () => {
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={readyRefine()}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");
    await screen.findByLabelText("最終プロンプト案（編集できます）");

    // 既存の live region は role が異なるため一意に取得できる。
    expect(
      screen.getByRole("status", { name: "送信状態" }),
    ).toHaveTextContent("プロンプト案ができました");
    expect(screen.getByRole("status", { name: "コピー結果" })).toBeInTheDocument();
    expect(screen.getByRole("log")).toBeInTheDocument();
  });
});

describe("世代管理 (stale response)", () => {
  it("処理中は2つ目の世代を開始しない (二重送信ガード)", async () => {
    // UI 経路では 41-1 のガードが効くため、同時に2世代は走らない。
    // requestId による破棄そのものは composerReducer.test.ts で固定している。
    let calls = 0;
    const refine: PromptRefinementPort = {
      refine: () => {
        calls += 1;
        return new Promise<RefineResult>(() => {});
      },
    };

    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
        refine={refine}
      />,
    );

    await user.type(instructionArea(), SUFFICIENT);
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "送信状態" }),
      ).toHaveTextContent("内容を確認中"),
    );

    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    expect(calls).toBe(1);
    // 進行中の間、会話ログには user 発話1件だけが載る。
    expect(within(screen.getByRole("log")).getAllByText(SUFFICIENT)).toHaveLength(
      1,
    );
  });
});
