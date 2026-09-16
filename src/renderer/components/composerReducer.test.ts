import { describe, it, expect } from "vitest";
import {
  composerReducer,
  derivePhase,
  initialComposerState,
  type ComposerAction,
  type ComposerState,
} from "./composerReducer";
import type { RefineResult } from "@shared/media/promptRefinement";

/**
 * コンポーザ状態モデルの契約テスト (ADR-001 D5 / D7)。
 *
 * - turns は表示用の会話ログで、処理状態を持たない。
 * - follow-up / ready は処理状態ではなく派生値。
 * - 進行中の世代と一致しない非同期結果は捨てる。
 */

const READY: RefineResult = {
  status: "ready",
  draftPrompt: "夕暮れの海辺を歩く犬",
  summary: "要約",
};
const FOLLOW_UP: RefineResult = {
  status: "follow-up",
  questionIds: ["subject"],
  chipIds: ["cinematic"],
};

/** 一連の action を順に適用する。 */
function run(
  actions: readonly ComposerAction[],
  from: ComposerState = initialComposerState,
): ComposerState {
  return actions.reduce(composerReducer, from);
}

/** 指示を入力して送信し、refining 中の状態にする。 */
function refining(instruction = "夕暮れの海辺を歩く犬", requestId = "r1") {
  return run([
    { type: "instruction-changed", text: instruction },
    { type: "instruction-submitted", requestId, at: 1 },
  ]);
}

describe("会話ログ (turns)", () => {
  it("初回指示で user ターンが1件追加され refining になる", () => {
    const s = refining();
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({
      role: "user",
      kind: "instruction",
      text: "夕暮れの海辺を歩く犬",
    });
    expect(s.operation).toEqual({ status: "refining", requestId: "r1" });
  });

  it("follow-up 結果で assistant ターンが追加され idle に戻る", () => {
    const s = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: FOLLOW_UP,
    });
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1]).toMatchObject({
      role: "assistant",
      kind: "follow-up",
      messageKey: "media.composer.turn.followUp",
    });
    expect(s.turns[1]?.text).toBeUndefined();
    expect(s.followUpIds).toEqual({
      questionIds: ["subject"],
      chipIds: ["cinematic"],
    });
    expect(s.operation).toEqual({ status: "idle" });
  });

  it("補足回答の送信で user ターンが追加される", () => {
    const s = run([
      { type: "answer-changed", id: "subject", text: "浜辺を走る犬" },
      { type: "follow-up-answered", requestId: "r2", at: 3, text: "浜辺を走る犬" },
    ], composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: FOLLOW_UP,
    }));
    expect(s.turns).toHaveLength(3);
    expect(s.turns[2]).toMatchObject({ role: "user", kind: "answer" });
  });

  it("ready 結果で draft と summary が入り ready になる", () => {
    const s = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    expect(s.draft.prompt).toBe(READY.draftPrompt);
    expect(s.summary).toBe("要約");
    expect(derivePhase(s)).toBe("ready");
    expect(s.turns[1]).toMatchObject({ role: "assistant", kind: "draft" });
  });

  it("ドラフト編集は会話ログを壊さない", () => {
    const ready = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    const edited = composerReducer(ready, {
      type: "draft-changed",
      text: "書き換えた本文",
    });
    expect(edited.turns).toEqual(ready.turns);
    expect(edited.draft.prompt).toBe("書き換えた本文");
  });

  it("本文を全消ししても ready を維持する (提示済みかで判定する)", () => {
    const ready = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    const cleared = composerReducer(ready, { type: "draft-changed", text: "" });
    expect(derivePhase(cleared)).toBe("ready");
  });

  it("turns は処理状態を持たない", () => {
    const s = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    for (const turn of s.turns) {
      expect(Object.keys(turn).sort()).not.toContain("requestId");
      expect(Object.keys(turn).sort()).not.toContain("copyState");
      expect(Object.keys(turn).sort()).not.toContain("operation");
    }
  });

  it("進捗 (refining / sending) は turns に追加されない", () => {
    const ready = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    const sending = composerReducer(
      composerReducer(ready, { type: "send-requested", requestId: "s1" }),
      { type: "send-accepted", requestId: "s1", jobId: "job-1" },
    );
    expect(sending.turns).toEqual(ready.turns);
    const done = composerReducer(sending, {
      type: "send-succeeded",
      requestId: "s1",
    });
    expect(done.turns).toEqual(ready.turns);
  });
});

describe("stale response の破棄", () => {
  it("新しい世代を始めた後に古い成功が届いても無視する", () => {
    const first = refining("犬", "r1");
    const second = composerReducer(first, {
      type: "instruction-submitted",
      requestId: "r2",
      at: 5,
    });
    const stale = composerReducer(second, {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 6,
      result: READY,
    });
    expect(stale).toBe(second);
    expect(stale.draft.prompt).toBe("");
    expect(derivePhase(stale)).toBe("validating");
  });

  it("古い失敗が遅れて届いても error にしない", () => {
    const second = composerReducer(refining("犬", "r1"), {
      type: "instruction-submitted",
      requestId: "r2",
      at: 5,
    });
    const stale = composerReducer(second, {
      type: "refinement-failed",
      requestId: "r1",
      message: "backend down",
    });
    expect(stale.operation).toEqual({ status: "refining", requestId: "r2" });
    expect(stale.errorMessage).toBeNull();
  });

  it("reset 後に前世代の成功が届いても状態が復活しない", () => {
    const afterReset = composerReducer(refining("犬", "r1"), {
      type: "reset-requested",
    });
    const stale = composerReducer(afterReset, {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 9,
      result: READY,
    });
    expect(stale).toBe(afterReset);
    expect(stale.turns).toHaveLength(0);
    expect(derivePhase(stale)).toBe("idle");
  });

  it("送信でも古い結果を捨てる", () => {
    const ready = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    const sending = composerReducer(
      composerReducer(ready, { type: "send-requested", requestId: "s2" }),
      { type: "send-accepted", requestId: "s2", jobId: "job-2" },
    );
    expect(
      composerReducer(sending, { type: "send-succeeded", requestId: "s1" }),
    ).toBe(sending);
    expect(
      composerReducer(sending, {
        type: "send-failed",
        requestId: "s1",
        message: "old",
      }),
    ).toBe(sending);
  });
});

describe("エラーと復帰", () => {
  it("送信失敗で error になり、入力・回答・ドラフトを保持する", () => {
    const ready = run(
      [{ type: "answer-changed", id: "subject", text: "犬" }],
      composerReducer(refining(), {
        type: "refinement-succeeded",
        requestId: "r1",
        at: 2,
        result: READY,
      }),
    );
    const failed = run([
      { type: "send-requested", requestId: "s1" },
      { type: "send-accepted", requestId: "s1", jobId: "job-1" },
      { type: "send-failed", requestId: "s1", message: "backend down" },
    ], ready);

    expect(derivePhase(failed)).toBe("error");
    expect(failed.errorMessage).toBe("backend down");
    expect(failed.instruction).toBe(ready.instruction);
    expect(failed.answers).toEqual(ready.answers);
    expect(failed.draft.prompt).toBe(ready.draft.prompt);
  });

  it("source 未入力の拒否は ready のままで alert だけ出す", () => {
    const ready = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    const rejected = composerReducer(ready, {
      type: "send-rejected-locally",
      message: "元画像のパスが必要です",
    });
    expect(derivePhase(rejected)).toBe("ready");
    expect(rejected.sourceInvalid).toBe(true);
    expect(rejected.errorMessage).toBe("元画像のパスが必要です");
  });

  it("redo は error を解除して ready へ戻す", () => {
    const failed = run([
      { type: "refinement-succeeded", requestId: "r1", at: 2, result: READY },
      { type: "send-requested", requestId: "s1" },
      { type: "send-accepted", requestId: "s1", jobId: "job-1" },
      { type: "send-failed", requestId: "s1", message: "x" },
      { type: "redo-requested" },
    ], refining());
    expect(derivePhase(failed)).toBe("ready");
    expect(failed.errorMessage).toBeNull();
  });

  it("reset で会話ログを含めて初期状態へ戻る", () => {
    const s = composerReducer(
      composerReducer(refining(), {
        type: "refinement-succeeded",
        requestId: "r1",
        at: 2,
        result: READY,
      }),
      { type: "reset-requested" },
    );
    expect(s.turns).toHaveLength(0);
    expect(s.instruction).toBe("");
    expect(s.draft.prompt).toBe("");
    expect(derivePhase(s)).toBe("idle");
  });
});

describe("params と assets (PR-C)", () => {
  it("param-changed は該当フィールドのみ更新し turns / operation に触れない", () => {
    const ready = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    const s = composerReducer(ready, {
      type: "param-changed",
      key: "fps",
      value: 24,
    });
    expect(s.draft.params.fps).toBe(24);
    expect(s.draft.params.durationSec).toBe(ready.draft.params.durationSec);
    expect(s.draft.prompt).toBe(ready.draft.prompt);
    expect(s.turns).toEqual(ready.turns);
    expect(s.operation).toEqual(ready.operation);
  });

  it("param-changed に undefined を渡すと未入力に戻す", () => {
    const s = composerReducer(initialComposerState, {
      type: "param-changed",
      key: "durationSec",
      value: undefined,
    });
    expect("durationSec" in s.draft.params).toBe(false);
  });

  it("asset-changed は種別ごとに1件を保持し、空文字で取り下げる", () => {
    const withImage = composerReducer(initialComposerState, {
      type: "asset-changed",
      kind: "image",
      path: "/abs/a.png",
    });
    expect(withImage.draft.assets).toEqual([
      { kind: "image", path: "/abs/a.png" },
    ]);

    const replaced = composerReducer(withImage, {
      type: "asset-changed",
      kind: "image",
      path: "/abs/b.png",
    });
    expect(replaced.draft.assets).toEqual([
      { kind: "image", path: "/abs/b.png" },
    ]);

    const withAudio = composerReducer(replaced, {
      type: "asset-changed",
      kind: "audio",
      path: "/abs/a.wav",
    });
    expect(withAudio.draft.assets).toHaveLength(2);

    const removed = composerReducer(withAudio, {
      type: "asset-changed",
      kind: "image",
      path: "",
    });
    expect(removed.draft.assets).toEqual([
      { kind: "audio", path: "/abs/a.wav" },
    ]);
  });

  it("送信失敗後も params と assets を保持する", () => {
    const ready = run([
      { type: "param-changed", key: "fps", value: 16 },
      { type: "asset-changed", kind: "image", path: "/abs/in.png" },
    ], composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    }));
    const failed = run([
      { type: "send-requested", requestId: "s1" },
      { type: "send-accepted", requestId: "s1", jobId: "job-1" },
      { type: "send-failed", requestId: "s1", message: "backend down" },
    ], ready);
    expect(failed.draft.params.fps).toBe(16);
    expect(failed.draft.assets).toEqual(ready.draft.assets);
  });

  it("reset は params / assets を初期化し、redo は保持する", () => {
    const ready = run([
      { type: "param-changed", key: "fps", value: 16 },
      { type: "asset-changed", kind: "image", path: "/abs/in.png" },
    ], composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    }));

    const redone = composerReducer(ready, { type: "redo-requested" });
    expect(redone.draft.params.fps).toBe(16);
    expect(redone.draft.assets).toHaveLength(1);

    const reseted = composerReducer(ready, { type: "reset-requested" });
    expect(reseted.draft.assets).toEqual([]);
    expect(reseted.draft.params.fps).toBe(16);
    expect(reseted.draft.params.durationSec).toBe(5);
  });
});

describe("redo と reset の切り分け", () => {
  function failedAfterReady() {
    return run([
      { type: "refinement-succeeded", requestId: "r1", at: 2, result: READY },
      { type: "send-requested", requestId: "s1" },
      { type: "send-accepted", requestId: "s1", jobId: "job-1" },
      { type: "send-failed", requestId: "s1", message: "backend down" },
    ], refining());
  }

  it("redo は編集復帰: ready を維持し draftProduced を落とさない", () => {
    const s = composerReducer(failedAfterReady(), { type: "redo-requested" });
    expect(derivePhase(s)).toBe("ready");
    expect(s.draftProduced).toBe(true);
    expect(s.draft.prompt).toBe(READY.draftPrompt);
    expect(s.summary).toBe("要約");
    expect(s.instruction).toBe("夕暮れの海辺を歩く犬");
    expect(s.turns).toEqual(failedAfterReady().turns);
    expect(s.operation).toEqual({ status: "idle" });
  });

  it("draftProduced が false に戻るのは reset だけ", () => {
    const failed = failedAfterReady();
    expect(composerReducer(failed, { type: "redo-requested" }).draftProduced).toBe(
      true,
    );
    expect(
      composerReducer(failed, { type: "reset-requested" }).draftProduced,
    ).toBe(false);
  });

  it("reset は新規開始: 会話も入力もすべて初期化する", () => {
    const s = composerReducer(failedAfterReady(), { type: "reset-requested" });
    expect(s.turns).toHaveLength(0);
    expect(s.instruction).toBe("");
    expect(s.answers).toEqual({});
    expect(s.draft.prompt).toBe("");
    expect(s.summary).toBe("");
    expect(s.draft.assets).toEqual([]);
    expect(s.errorMessage).toBeNull();
    expect(s.operation).toEqual({ status: "idle" });
    expect(derivePhase(s)).toBe("idle");
  });
});

describe("errorMessage の解除", () => {
  function rejectedLocally() {
    return run([
      { type: "refinement-succeeded", requestId: "r1", at: 2, result: READY },
      { type: "send-rejected-locally", message: "元画像のパスが必要です" },
    ], refining());
  }

  it("原因の入力を直すと解除される (asset-changed)", () => {
    const s = composerReducer(rejectedLocally(), {
      type: "asset-changed",
      kind: "image",
      path: "/abs/in.png",
    });
    expect(s.errorMessage).toBeNull();
    expect(s.sourceInvalid).toBe(false);
    expect(derivePhase(s)).toBe("ready");
  });

  it("redo / reset / 新規送信開始で解除される", () => {
    const rejected = rejectedLocally();
    expect(
      composerReducer(rejected, { type: "redo-requested" }).errorMessage,
    ).toBeNull();
    expect(
      composerReducer(rejected, { type: "reset-requested" }).errorMessage,
    ).toBeNull();
    expect(
      composerReducer(rejected, { type: "send-requested", requestId: "s9" })
        .errorMessage,
    ).toBeNull();
  });

  it("新しい指示・補足回答の送信でも解除される", () => {
    const failed = run([
      { type: "refinement-failed", requestId: "r1", message: "backend down" },
    ], refining());
    expect(failed.errorMessage).toBe("backend down");
    expect(
      composerReducer(failed, {
        type: "instruction-submitted",
        requestId: "r9",
        at: 9,
      }).errorMessage,
    ).toBeNull();
    expect(
      composerReducer(failed, {
        type: "follow-up-answered",
        requestId: "r9",
        at: 9,
        text: "回答",
      }).errorMessage,
    ).toBeNull();
  });
});

describe("コピーは送信の状態機械から独立", () => {
  it("copy-* は operation と turns に触れない", () => {
    const ready = composerReducer(refining(), {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    for (const type of ["copy-succeeded", "copy-failed", "copy-cleared"] as const) {
      const s = composerReducer(ready, { type });
      expect(s.operation).toEqual(ready.operation);
      expect(s.turns).toEqual(ready.turns);
      expect(derivePhase(s)).toBe("ready");
    }
  });
});

describe("旧 phase との対応", () => {
  it("7種すべてを派生値で再現できる", () => {
    const idle = initialComposerState;
    const validating = refining();
    const followUp = composerReducer(validating, {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: FOLLOW_UP,
    });
    const ready = composerReducer(validating, {
      type: "refinement-succeeded",
      requestId: "r1",
      at: 2,
      result: READY,
    });
    const checking = composerReducer(ready, {
      type: "send-requested",
      requestId: "s1",
    });
    const sending = composerReducer(checking, {
      type: "send-accepted",
      requestId: "s1",
      jobId: "job-1",
    });
    const success = composerReducer(sending, {
      type: "send-succeeded",
      requestId: "s1",
    });
    const error = composerReducer(sending, {
      type: "send-failed",
      requestId: "s1",
      message: "x",
    });

    expect(derivePhase(idle)).toBe("idle");
    expect(derivePhase(validating)).toBe("validating");
    expect(derivePhase(followUp)).toBe("follow-up");
    expect(derivePhase(ready)).toBe("ready");
    expect(derivePhase(checking)).toBe("checking");
    expect(derivePhase(sending)).toBe("sending");
    expect(derivePhase(success)).toBe("success");
    expect(derivePhase(error)).toBe("error");
  });
});
