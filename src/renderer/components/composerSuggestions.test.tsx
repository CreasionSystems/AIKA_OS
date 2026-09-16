import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPromptComposer } from "./VideoPromptComposer";
import {
  composerReducer,
  derivePhase,
  initialComposerState,
  type ComposerState,
} from "./composerReducer";
import type { RefineResult } from "@shared/media/promptRefinement";

/**
 * PR-D: 構造化パラメータ候補の適用規則 (ADR-001 D1)。
 *
 * 候補は draft.params へ自動反映しない。適用はユーザーの明示操作のみ。
 * 候補の詳細は会話ログ (role="log") の本文に入れない。
 */
const WITH_SUGGESTIONS = "夕暮れの海辺を歩く犬を10秒でシネマティックに";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const READY_WITH_SUGGESTIONS: RefineResult = {
  status: "ready",
  draftPrompt: WITH_SUGGESTIONS,
  summary: WITH_SUGGESTIONS,
  suggestedParams: [
    { key: "durationSec", value: 10, confidence: "high", reasonKey: "explicitDuration" },
    { key: "qualityPreset", value: "high", confidence: "low", reasonKey: "cinematic" },
  ],
};

/** refinement 成功直後の状態を作る。 */
function afterRefinement(requestId = "r1"): ComposerState {
  return [
    { type: "instruction-changed", text: WITH_SUGGESTIONS } as const,
    { type: "instruction-submitted", requestId, at: 1 } as const,
    {
      type: "refinement-succeeded",
      requestId,
      at: 2,
      result: READY_WITH_SUGGESTIONS,
    } as const,
  ].reduce(composerReducer, initialComposerState);
}

describe("適用規則 (reducer)", () => {
  it("初期状態では候補を持たない", () => {
    expect(initialComposerState.suggestions).toEqual([]);
  });

  it("refinement 成功で候補が入るが draft.params は変わらない", () => {
    const before = initialComposerState.draft.params;
    const s = afterRefinement();
    expect(s.suggestions.map((x) => x.key)).toEqual([
      "durationSec",
      "qualityPreset",
    ]);
    expect(s.draft.params).toEqual(before);
    expect(s.draft.params.qualityPreset).toBeUndefined();
    expect(s.draft.params.durationSec).toBe(5);
  });

  it("適用した候補だけが draft.params に入り、一覧から消える", () => {
    const applied = composerReducer(afterRefinement(), {
      type: "suggestion-applied",
      key: "qualityPreset",
    });
    expect(applied.draft.params.qualityPreset).toBe("high");
    // 適用していない候補は draft に入らない。
    expect(applied.draft.params.durationSec).toBe(5);
    expect(applied.suggestions.map((s) => s.key)).toEqual(["durationSec"]);
  });

  it("ユーザーが編集済みの値は、適用操作をしない限り変わらない", () => {
    const edited = composerReducer(afterRefinement(), {
      type: "param-changed",
      key: "durationSec",
      value: 3,
    });
    expect(edited.draft.params.durationSec).toBe(3);
    expect(edited.suggestions.map((s) => s.key)).toContain("durationSec");

    // 別の候補を適用しても、編集済みの値には触れない。
    const applied = composerReducer(edited, {
      type: "suggestion-applied",
      key: "qualityPreset",
    });
    expect(applied.draft.params.durationSec).toBe(3);

    // 明示適用したときだけ上書きされる。
    const overwritten = composerReducer(applied, {
      type: "suggestion-applied",
      key: "durationSec",
    });
    expect(overwritten.draft.params.durationSec).toBe(10);
  });

  it("候補を閉じても draft.params は変わらない", () => {
    const s = afterRefinement();
    const dismissed = composerReducer(s, { type: "suggestions-dismissed" });
    expect(dismissed.suggestions).toEqual([]);
    expect(dismissed.draft.params).toEqual(s.draft.params);
  });

  it("候補の適用は turns と operation に触れない", () => {
    const s = afterRefinement();
    const applied = composerReducer(s, {
      type: "suggestion-applied",
      key: "durationSec",
    });
    expect(applied.turns).toEqual(s.turns);
    expect(applied.operation).toEqual(s.operation);
    expect(derivePhase(applied)).toBe("ready");
  });

  it("redo では保持し、reset では破棄する", () => {
    const s = afterRefinement();
    expect(
      composerReducer(s, { type: "redo-requested" }).suggestions,
    ).toHaveLength(2);
    expect(
      composerReducer(s, { type: "reset-requested" }).suggestions,
    ).toEqual([]);
  });

  it("古い世代の結果では候補が入らない (stale 保証を壊さない)", () => {
    const second = composerReducer(afterRefinement("r1"), {
      type: "instruction-submitted",
      requestId: "r2",
      at: 5,
    });
    const stale = composerReducer(second, {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 6,
      result: {
        status: "ready",
        draftPrompt: "古い案",
        summary: "古い",
        suggestedParams: [{ key: "fps", value: 8 }],
      },
    });
    expect(stale).toBe(second);
    expect(stale.suggestions.map((s) => s.key)).not.toContain("fps");
  });

  it("会話ログには候補の件数だけを載せ、値は載せない", () => {
    const s = afterRefinement();
    const draftTurn = s.turns.find((t) => t.kind === "draft");
    expect(draftTurn?.messageKey).toBe(
      "media.composer.turn.draftWithSuggestions",
    );
    expect(draftTurn?.values).toEqual({ count: 2 });
    expect(draftTurn?.text).toBeUndefined();
  });
});

describe("適用 UI", () => {
  async function renderReady() {
    const user = userEvent.setup();
    render(
      <VideoPromptComposer
        kind="t2v"
        sourceRequired={false}
        onSubmit={vi.fn(async () => {})}
      />,
    );
    await user.type(
      screen.getByLabelText("作りたい動画の内容"),
      WITH_SUGGESTIONS,
    );
    await user.click(screen.getByRole("button", { name: "内容をまとめる" }));
    await screen.findByLabelText("最終プロンプト案（編集できます）");
    return user;
  }

  it("候補が一覧表示され、適用するまで入力欄は変わらない", async () => {
    const user = await renderReady();

    const panel = screen.getByRole("region", { name: "候補" });
    expect(within(panel).getByText("品質: high")).toBeInTheDocument();
    expect(screen.getByLabelText("品質")).toHaveValue("");

    await user.click(within(panel).getAllByRole("button", { name: "適用" })[1]!);
    expect(screen.getByLabelText("品質")).toHaveValue("high");
  });

  it("候補を閉じると一覧が消え、入力欄は変わらない", async () => {
    const user = await renderReady();

    expect(screen.getByLabelText("長さ（秒）")).toHaveValue(5);
    await user.click(screen.getByRole("button", { name: "候補を閉じる" }));

    expect(screen.queryByRole("region", { name: "候補" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("長さ（秒）")).toHaveValue(5);
  });

  it("候補の詳細は会話ログの本文に入らない", async () => {
    await renderReady();
    const log = screen.getByRole("log");
    // 件数の通知は出すが、値そのものは出さない。
    expect(within(log).getByText(/候補 2 件/)).toBeInTheDocument();
    expect(within(log).queryByText(/高品質/)).not.toBeInTheDocument();
    expect(within(log).queryByRole("button", { name: "適用" })).toBeNull();
  });
});
