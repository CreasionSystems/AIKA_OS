import { describe, it, expect, vi } from "vitest";
import { DummyInferenceAdapter } from "./dummyInferenceAdapter";
import type { InferencePort } from "@shared/inference/port";

/**
 * InferencePort を満たす正式な Fake (Dummy) アダプタの契約テスト。
 *
 * 目的: 本物の推論基盤 (Ollama / ComfyUI / 画像生成) なしで
 *       UI・ジョブ管理・状態遷移・エラーハンドリングを先に完成させる。
 *
 * 契約:
 *  - InferencePort の全メソッドを実装する
 *  - 固定 (決定的) レスポンスを返す
 *  - 擬似遅延を挟む (注入した sleep を delayMs で呼ぶ)
 */

/** 注入用: 待たずに呼び出しを記録するだけの sleep。 */
function makeFakeSleep() {
  const calls: number[] = [];
  const sleep = vi.fn(async (ms: number) => {
    calls.push(ms);
  });
  return { sleep, calls };
}

/** 注入用: 決定的な連番 ID ファクトリ。 */
function makeSeqIdFactory() {
  let n = 0;
  return () => `dummy-job-${++n}`;
}

function makeAdapter(delayMs = 5) {
  const { sleep, calls } = makeFakeSleep();
  const adapter = new DummyInferenceAdapter({
    delayMs,
    sleep,
    idFactory: makeSeqIdFactory(),
  });
  return { adapter, sleep, calls };
}

describe("DummyInferenceAdapter は InferencePort を満たす", () => {
  it("InferencePort 型に代入できる (構造的契約)", () => {
    const port: InferencePort = makeAdapter().adapter;
    expect(typeof port.healthCheck).toBe("function");
    expect(typeof port.generateText).toBe("function");
    expect(typeof port.generateCodePlan).toBe("function");
    expect(typeof port.runImageJob).toBe("function");
    expect(typeof port.runVideoJob).toBe("function");
  });
});

describe("healthCheck", () => {
  it("ok を返し、adapter 識別子が dummy", async () => {
    const { adapter } = makeAdapter();
    const health = await adapter.healthCheck();
    expect(health.status).toBe("ok");
    expect(health.adapter).toBe("dummy");
  });
});

describe("generateText", () => {
  it("決定的なテキストを返し、要求モードを反映する", async () => {
    const { adapter } = makeAdapter();
    const a = await adapter.generateText({ prompt: "hello", mode: "novel" });
    const b = await adapter.generateText({ prompt: "hello", mode: "novel" });
    expect(a.text).toBe(b.text); // 決定的
    expect(a.text).toContain("novel");
    expect(a.finishReason).toBe("stop");
    expect(a.usage.promptTokens).toBeGreaterThan(0);
  });

  it("擬似遅延として注入 sleep を delayMs で呼ぶ", async () => {
    const { adapter, calls } = makeAdapter(7);
    await adapter.generateText({ prompt: "x" });
    expect(calls).toContain(7);
  });
});

describe("generateCodePlan", () => {
  it("空でない手順配列を持つ計画を返す", async () => {
    const { adapter } = makeAdapter();
    const plan = await adapter.generateCodePlan({ goal: "add feature" });
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]?.title).toBeTruthy();
    expect(plan.summary).toContain("add feature");
  });
});

describe("runImageJob (拡張境界, Fake)", () => {
  it("成功ジョブを返し backend=dummy、jobId は決定的連番", async () => {
    const { adapter } = makeAdapter();
    const r1 = await adapter.runImageJob({ prompt: "a cat" });
    const r2 = await adapter.runImageJob({ prompt: "a cat" });
    expect(r1.status).toBe("succeeded");
    expect(r1.backend).toBe("dummy");
    expect(r1.jobId).toBe("dummy-job-1");
    expect(r2.jobId).toBe("dummy-job-2");
    expect(r1.artifacts.length).toBeGreaterThan(0);
  });
});

describe("runVideoJob (拡張境界, Fake)", () => {
  it("動画種別を反映した成功ジョブを返す", async () => {
    const { adapter } = makeAdapter();
    const r = await adapter.runVideoJob({ kind: "t2v", prompt: "a dog runs" });
    expect(r.status).toBe("succeeded");
    expect(r.backend).toBe("dummy");
    expect(r.kind).toBe("t2v");
    expect(r.artifacts.length).toBeGreaterThan(0);
  });
});
