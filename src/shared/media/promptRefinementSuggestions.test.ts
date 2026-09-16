import { describe, it, expect } from "vitest";
import {
  createDummyPromptRefinement,
  suggestParamsFromInstruction,
  FOLLOW_UP_QUESTIONS,
  FOLLOW_UP_QUESTION_IDS,
} from "./promptRefinement";

/**
 * PR-D: 補完ポートが返す構造化パラメータ候補と、意味 id ベースの補足質問。
 *
 * ADR-001 D1 / D4: 候補はあくまで提案であり、port は表示文言を返さない。
 * Dummy は LLM を使わず決定的に振る舞う。
 */

describe("suggestParamsFromInstruction", () => {
  it("「10秒」から durationSec を高い確信度で提案する", () => {
    const out = suggestParamsFromInstruction("海辺を歩く犬を10秒で");
    expect(out).toContainEqual({
      key: "durationSec",
      value: 10,
      confidence: "high",
      reasonKey: "explicitDuration",
    });
  });

  it("スローモーション指定で motionStrength を下げる候補を出す", () => {
    const out = suggestParamsFromInstruction("犬をスローモーションで");
    const motion = out.find((s) => s.key === "motionStrength");
    expect(motion).toMatchObject({ value: 0.2, reasonKey: "slowMotion" });
  });

  it("シネマティック指定で qualityPreset を上げる候補を出す", () => {
    const out = suggestParamsFromInstruction("シネマティックな夜の街");
    expect(out).toContainEqual({
      key: "qualityPreset",
      value: "high",
      confidence: "low",
      reasonKey: "cinematic",
    });
  });

  it("該当する語がなければ候補を出さない", () => {
    expect(suggestParamsFromInstruction("浜辺を走る犬")).toEqual([]);
  });

  it("複数該当すれば複数返す (決定的な順序)", () => {
    const out = suggestParamsFromInstruction(
      "シネマティックに10秒、スローモーションで",
    );
    expect(out.map((s) => s.key)).toEqual([
      "durationSec",
      "motionStrength",
      "qualityPreset",
    ]);
  });

  it("同じ入力から常に同じ結果を返す", () => {
    const input = "10秒のシネマティックな映像";
    expect(suggestParamsFromInstruction(input)).toEqual(
      suggestParamsFromInstruction(input),
    );
  });
});

describe("Dummy 実装", () => {
  const port = createDummyPromptRefinement();

  it("ready でも follow-up でも候補を返せる", async () => {
    const ready = await port.refine({
      instruction: "夕暮れの海辺を歩く犬を10秒でシネマティックに",
    });
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") return;
    expect(ready.suggestedParams?.map((s) => s.key)).toEqual([
      "durationSec",
      "qualityPreset",
    ]);

    const followUp = await port.refine({ instruction: "10秒" });
    expect(followUp.status).toBe("follow-up");
    if (followUp.status !== "follow-up") return;
    expect(followUp.suggestions?.[0]).toMatchObject({ key: "durationSec" });
  });

  it("候補が無ければフィールド自体を省く", async () => {
    const result = await port.refine({ instruction: "浜辺を走るゴールデンレトリバーをきれいに撮りたい" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.suggestedParams).toBeUndefined();
  });

  it("follow-up は意味 id の questions を返し、questionIds も当面併存する", async () => {
    const result = await port.refine({ instruction: "犬" });
    expect(result.status).toBe("follow-up");
    if (result.status !== "follow-up") return;
    expect(result.questions).toEqual(FOLLOW_UP_QUESTIONS);
    expect(result.questionIds).toEqual(FOLLOW_UP_QUESTION_IDS);
  });

  it("questions は表示文言を持たず、意味 id と関係フィールドだけを返す", () => {
    for (const q of FOLLOW_UP_QUESTIONS) {
      expect(Object.keys(q).sort()).not.toContain("text");
      expect(Object.keys(q).sort()).not.toContain("label");
      expect(typeof q.id).toBe("string");
    }
    expect(FOLLOW_UP_QUESTIONS.find((q) => q.id === "motion")?.fields).toEqual([
      "motionStrength",
    ]);
  });

  it("RefineInput の currentDraft / currentParams / assets を受け取れる", async () => {
    const result = await port.refine({
      instruction: "夕暮れの海辺を歩く犬をシネマティックに",
      answers: {},
      currentDraft: "編集中の本文",
      currentParams: { fps: 24 },
      assets: [{ kind: "image", path: "/abs/in.png" }],
    });
    expect(result.status).toBe("ready");
  });
});
