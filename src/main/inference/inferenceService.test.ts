import { describe, it, expect } from "vitest";
import { InferenceService } from "./inferenceService";
import { DummyInferenceAdapter } from "./dummyInferenceAdapter";
import { JobQueue } from "@main/jobs/jobQueue";
import { WritingValidationError } from "@shared/writing/writingModes";
import type {
  ImageJobResult,
  InferencePort,
  TextGenerationRequest,
  TextGenerationResult,
  VideoJobResult,
} from "@shared/inference/port";

/**
 * InferenceService — InferencePort × JobQueue の結線サービス。
 *
 * 中核フロー: submit* で投入 -> JobQueue が状態遷移 -> 結果取得。
 * 本物の推論基盤なしで (DummyInferenceAdapter) 決定的に検証する。
 */

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeClock(start = 0) {
  let t = start;
  return () => ++t;
}

function makeImageIdFactory() {
  let n = 0;
  return () => `img-${++n}`;
}

function makeService(port?: InferencePort) {
  const adapter =
    port ??
    new DummyInferenceAdapter({
      delayMs: 0,
      sleep: async () => {},
      idFactory: makeImageIdFactory(),
    });
  const queue = new JobQueue({ now: makeClock(), idFactory: () => "job-1" });
  return new InferenceService(adapter, queue);
}

/**
 * sleep をゲート化したサービス。release() を呼ぶまでアダプタは完了せず、
 * running 状態を決定的に観測できる。
 */
function makeGatedService() {
  const gate = makeDeferred<void>();
  const adapter = new DummyInferenceAdapter({
    delayMs: 0,
    sleep: () => gate.promise,
    idFactory: makeImageIdFactory(),
  });
  const queue = new JobQueue({ now: makeClock(), idFactory: () => "job-1" });
  return { svc: new InferenceService(adapter, queue), release: gate.resolve };
}

/** 必ず失敗する InferencePort (失敗経路テスト用)。 */
function makeFailingPort(): InferencePort {
  const fail = async (): Promise<never> => {
    throw new Error("backend exploded");
  };
  return {
    healthCheck: async () => ({ status: "down", adapter: "failing" }),
    generateText: fail,
    generateCodePlan: fail,
    runImageJob: fail,
    runVideoJob: fail,
  };
}

describe("submitImageJob: 投入 -> 状態遷移 -> 結果取得", () => {
  it("queued -> running -> succeeded と遷移し、結果を取得できる", async () => {
    const { svc, release } = makeGatedService();
    const id = svc.submitImageJob({ prompt: "a cat" });

    expect(svc.getJob(id)?.state).toBe("queued");

    await nextTick();
    expect(svc.getJob(id)?.state).toBe("running"); // ゲートで保持

    release();
    await svc.whenSettled(id);
    const job = svc.getJob<ImageJobResult>(id);
    expect(job?.state).toBe("succeeded");
    expect(job?.result?.backend).toBe("dummy");
    expect(job?.result?.artifacts[0]?.startsWith("/")).toBe(true);
  });

  it("キュー job id とアダプタ result.jobId は別系統", async () => {
    const svc = makeService();
    const id = svc.submitImageJob({ prompt: "x" });
    await svc.whenSettled(id);
    const job = svc.getJob<ImageJobResult>(id);
    expect(id).toBe("job-1"); // キュー側
    expect(job?.result?.jobId).toBe("img-1"); // アダプタ側
  });
});

describe("submitVideoJob", () => {
  it("動画種別を保持したまま succeeded になる", async () => {
    const svc = makeService();
    const id = svc.submitVideoJob({ kind: "i2v", sourceImage: "/abs/in.png" });
    await svc.whenSettled(id);
    const job = svc.getJob<VideoJobResult>(id);
    expect(job?.state).toBe("succeeded");
    expect(job?.result?.kind).toBe("i2v");
  });
});

describe("失敗経路", () => {
  it("アダプタが throw すると job は failed になり error を保持する", async () => {
    const svc = makeService(makeFailingPort());
    const id = svc.submitImageJob({ prompt: "boom" });
    await svc.whenSettled(id);
    const job = svc.getJob(id);
    expect(job?.state).toBe("failed");
    expect(job?.error).toContain("backend exploded");
  });
});

/** generateText 呼び出しを記録する InferencePort。 */
function makeRecordingPort(): {
  port: InferencePort;
  calls: TextGenerationRequest[];
} {
  const calls: TextGenerationRequest[] = [];
  const notUsed = async (): Promise<never> => {
    throw new Error("not used");
  };
  const port: InferencePort = {
    healthCheck: async () => ({ status: "ok", adapter: "recording" }),
    generateText: async (req): Promise<TextGenerationResult> => {
      calls.push(req);
      return {
        text: `recorded:${req.mode}`,
        finishReason: "stop",
        model: "recording",
        usage: { promptTokens: 1, completionTokens: 1 },
      };
    },
    generateCodePlan: notUsed,
    runImageJob: notUsed,
    runVideoJob: notUsed,
  };
  return { port, calls };
}

function makeTextService(port: InferencePort) {
  const queue = new JobQueue({ now: makeClock(), idFactory: () => "job-1" });
  return new InferenceService(port, queue);
}

describe("generateText: validate -> normalize -> port.generateText", () => {
  it("正常時はモード別既定で正規化して port を呼び、結果を返す", async () => {
    const { port, calls } = makeRecordingPort();
    const svc = makeTextService(port);

    const result = await svc.generateText({
      mode: "business",
      prompt: "報告書を書く",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.mode).toBe("business");
    expect(calls[0]?.prompt).toBe("報告書を書く");
    expect(calls[0]?.maxTokens).toBe(2048); // business 既定
    expect(calls[0]?.temperature).toBe(0.3); // business 既定
    expect(result.text).toBe("recorded:business");
  });

  it("指定値は既定で上書きせず port へ渡す", async () => {
    const { port, calls } = makeRecordingPort();
    const svc = makeTextService(port);

    await svc.generateText({
      mode: "general",
      prompt: "x",
      maxTokens: 256,
      temperature: 0.5,
    });

    expect(calls[0]?.maxTokens).toBe(256);
    expect(calls[0]?.temperature).toBe(0.5);
  });

  it("空プロンプトは WritingValidationError で拒否し、port を呼ばない", async () => {
    const { port, calls } = makeRecordingPort();
    const svc = makeTextService(port);

    await expect(
      svc.generateText({ mode: "general", prompt: "   " }),
    ).rejects.toBeInstanceOf(WritingValidationError);
    expect(calls).toHaveLength(0);
  });

  it("禁止条件 (legal の高 temperature) を拒否し、違反明細を保持する", async () => {
    const { port, calls } = makeRecordingPort();
    const svc = makeTextService(port);

    await expect(
      svc.generateText({ mode: "legal", prompt: "契約書", temperature: 0.9 }),
    ).rejects.toMatchObject({
      violations: [{ code: "TEMPERATURE_NOT_ALLOWED" }],
    });
    expect(calls).toHaveLength(0);
  });
});
