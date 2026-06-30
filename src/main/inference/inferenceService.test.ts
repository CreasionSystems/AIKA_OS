import { describe, it, expect } from "vitest";
import { InferenceService } from "./inferenceService";
import { DummyInferenceAdapter } from "./dummyInferenceAdapter";
import { JobQueue } from "@main/jobs/jobQueue";
import type {
  ImageJobResult,
  InferencePort,
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
