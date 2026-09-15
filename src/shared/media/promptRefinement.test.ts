import { describe, it, expect } from "vitest";
import {
  createDummyPromptRefinement,
  isInstructionSufficient,
  composeDraftPrompt,
  MIN_SUFFICIENT_CHARS,
  FOLLOW_UP_QUESTION_IDS,
  SUGGESTION_CHIP_IDS,
} from "./promptRefinement";

/**
 * 動画プロンプト補完ドメインの契約テスト (純ロジック)。
 *
 * 自由指示を受け、曖昧/不足時のみ follow-up (補足質問 + 候補チップ) を返し、
 * 十分なら最終プロンプト案 (ready) を返す。将来 LLM アダプタへ差し替え可能な
 * Port 契約を固定する。
 */
describe("isInstructionSufficient", () => {
  it("十分な長さの指示は sufficient", () => {
    expect(
      isInstructionSufficient({ instruction: "a".repeat(MIN_SUFFICIENT_CHARS) }),
    ).toBe(true);
  });

  it("短すぎる指示は insufficient", () => {
    expect(isInstructionSufficient({ instruction: "犬" })).toBe(false);
    expect(isInstructionSufficient({ instruction: "   " })).toBe(false);
  });

  it("補足回答があれば短い指示でも sufficient", () => {
    expect(
      isInstructionSufficient({
        instruction: "犬",
        answers: { subject: "浜辺を走る犬" },
      }),
    ).toBe(true);
  });

  it("空の回答は sufficient に数えない", () => {
    expect(
      isInstructionSufficient({ instruction: "犬", answers: { subject: "  " } }),
    ).toBe(false);
  });
});

describe("composeDraftPrompt", () => {
  it("指示と非空の回答を決定的に連結する", () => {
    expect(
      composeDraftPrompt({
        instruction: "  浜辺を走る犬  ",
        answers: { subject: "ゴールデンレトリバー", motion: "  ", style: "シネマ" },
      }),
    ).toBe("浜辺を走る犬 / ゴールデンレトリバー / シネマ");
  });

  it("回答が無ければ指示のみ", () => {
    expect(composeDraftPrompt({ instruction: "夕暮れの都市を空撮" })).toBe(
      "夕暮れの都市を空撮",
    );
  });
});

describe("createDummyPromptRefinement", () => {
  it("曖昧な指示では follow-up (補足質問 + 候補チップ) を返す", async () => {
    const port = createDummyPromptRefinement();
    const result = await port.refine({ instruction: "犬" });
    expect(result.status).toBe("follow-up");
    if (result.status === "follow-up") {
      expect(result.questionIds).toEqual(FOLLOW_UP_QUESTION_IDS);
      expect(result.chipIds).toEqual(SUGGESTION_CHIP_IDS);
    }
  });

  it("十分な指示では ready (最終案 + 要約) を返す", async () => {
    const port = createDummyPromptRefinement();
    const result = await port.refine({
      instruction: "夕暮れの海辺を歩く犬をシネマティックに",
    });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.draftPrompt).toContain("夕暮れの海辺を歩く犬");
      expect(result.summary.length).toBeGreaterThan(0);
    }
  });

  it("補足回答があれば短い指示でも ready", async () => {
    const port = createDummyPromptRefinement();
    const result = await port.refine({
      instruction: "犬",
      answers: { subject: "浜辺を走るゴールデンレトリバー" },
    });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.draftPrompt).toContain("浜辺を走るゴールデンレトリバー");
    }
  });
});
