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
    const result = svc.submitVideoJob({
      kind: "i2v",
      prompt: "犬",
      params: {
        // 81 frames / 16fps。Dummy descriptor の frameCount (4n+1) を満たす。
        durationSec: 81 / 16,
        fps: 16,
        resolution: "720p",
        qualityPreset: "standard",
        motionStrength: 0.5,
      },
      assets: [{ kind: "image", path: "/abs/in.png" }],
    });
    expect(result.status).toBe("accepted");
    const id = result.status === "accepted" ? result.jobId : "";
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

describe("generateCodePlan", () => {
  it("port.generateCodePlan へ委譲し結果を返す", async () => {
    const svc = makeService(); // DummyInferenceAdapter
    const plan = await svc.generateCodePlan({ goal: "add feature" });
    expect(plan.summary).toContain("add feature");
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it("空の goal は拒否する", async () => {
    const svc = makeService();
    await expect(svc.generateCodePlan({ goal: "   " })).rejects.toThrow();
  });
});

describe("submitVideoJob: main 側の再検証 (PR-E)", () => {
  const VALID = {
    kind: "t2v" as const,
    prompt: "夕暮れの海辺を歩く犬",
    params: {
      // 81 frames / 16fps。Dummy descriptor の frameCount (4n+1) を満たす。
      durationSec: 81 / 16,
      fps: 16,
      resolution: "720p" as const,
      qualityPreset: "standard" as const,
      motionStrength: 0.5,
    },
    assets: [],
  };

  it("正当な要求は accepted で jobId を返す", () => {
    const svc = makeService();
    const result = svc.submitVideoJob(VALID);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.jobId).toBeTruthy();
  });

  it("renderer の結果を信頼せず、不正な要求は invalid を返す", () => {
    const svc = makeService();
    const result = svc.submitVideoJob({
      ...VALID,
      prompt: "   ",
      params: { ...VALID.params, motionStrength: 9 },
    });

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("missing-prompt");
    expect(codes).toContain("invalid-parameter");
    // 検証に落ちた要求は jobId を返さない (キューへ渡していない)。
    expect("jobId" in result).toBe(false);
  });

  it("i2v は必須資産が無ければ invalid になる", () => {
    const svc = makeService();
    const result = svc.submitVideoJob({ ...VALID, kind: "i2v", assets: [] });
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues.map((i) => i.code)).toContain("asset-count");
  });

  it("表示文言ではなく messageKey を返す", () => {
    const svc = makeService();
    const result = svc.submitVideoJob({ ...VALID, prompt: "" });
    if (result.status !== "invalid") return;
    for (const issue of result.issues) {
      expect(issue.messageKey.startsWith("media.validation.")).toBe(true);
    }
  });
});

describe("submitVideoJob: Router 境界 (PR-F2)", () => {
  const PARAMS = {
    durationSec: 81 / 16,
    fps: 16,
    resolution: "480p" as const,
    qualityPreset: "high" as const,
    motionStrength: 0.25,
  };
  const IMAGE = { kind: "image" as const, path: "/abs/in.png" };
  const AUDIO = { kind: "audio" as const, path: "/abs/in.wav" };

  /** port.runVideoJob の引数を記録するアダプタ。 */
  function makeSpyService() {
    const calls: unknown[] = [];
    const port = {
      healthCheck: async () => ({
        status: "ok" as const,
        adapter: "spy",
        prompt: "",
      }),
      generateText: async () => {
        throw new Error("unused");
      },
      generateCodePlan: async () => {
        throw new Error("unused");
      },
      runImageJob: async () => {
        throw new Error("unused");
      },
      runVideoJob: async (req: unknown) => {
        calls.push(req);
        return {
          jobId: "backend-1",
          status: "succeeded" as const,
          backend: "spy",
          kind: "audio" as const,
          artifacts: ["/abs/out.mp4"],
        };
      },
    };
    const queue = new JobQueue({ now: makeClock(), idFactory: () => "job-1" });
    return {
      svc: new InferenceService(port as never, queue),
      calls,
      queue,
    };
  }

  it("kind / templateId / inputs が adapter 呼び出しまで保持される", async () => {
    const { svc, calls } = makeSpyService();
    const result = svc.submitVideoJob({
      kind: "audio",
      prompt: "海辺の音に合わせて",
      params: PARAMS,
      assets: [AUDIO, IMAGE],
    });
    expect(result.status).toBe("accepted");

    // キューが実行するまで待つ。
    await vi.waitFor(() => expect(calls.length).toBe(1));
    const arg = calls[0] as {
      kind: string;
      templateId: string;
      inputs: Record<string, unknown>;
    };

    expect(arg.kind).toBe("audio");
    expect(arg.templateId).toBe("dummy-audio");
    expect(arg.inputs).toMatchObject({
      prompt: "海辺の音に合わせて",
      durationSec: PARAMS.durationSec,
      fps: PARAMS.fps,
      resolution: "480p",
      qualityPreset: "high",
      motionStrength: 0.25,
    });
    // image asset と 非 image asset の両方が残る。
    expect(arg.inputs.assets).toEqual([AUDIO, IMAGE]);
  });

  it("descriptor 違反の要求を main が拒否し、enqueue しない", async () => {
    const { svc, calls } = makeSpyService();
    const result = svc.submitVideoJob({
      kind: "t2v",
      prompt: "犬",
      // 5秒 x 16fps = 80 frames。Dummy descriptor の 4n+1 を満たさない。
      params: { ...PARAMS, durationSec: 5 },
      assets: [],
    });

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues.map((i) => i.code)).toContain("frame-constraint");
    expect(calls.length).toBe(0);
  });

  it("許容外の fps も main が拒否する (renderer を信頼しない)", () => {
    const { svc } = makeSpyService();
    const result = svc.submitVideoJob({
      kind: "t2v",
      prompt: "犬",
      params: { ...PARAMS, fps: 30, durationSec: 3 },
      assets: [],
    });
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(
      result.issues.some((i) => i.code === "invalid-parameter" && i.field === "fps"),
    ).toBe(true);
  });

  it("route() が null なら unsupported-kind を返し enqueue しない", () => {
    const port = {
      healthCheck: async () => ({ status: "ok" as const, adapter: "spy", prompt: "" }),
      generateText: async () => { throw new Error("unused"); },
      generateCodePlan: async () => { throw new Error("unused"); },
      runImageJob: async () => { throw new Error("unused"); },
      runVideoJob: async () => { throw new Error("should not be called"); },
    };
    const queue = new JobQueue({ now: makeClock(), idFactory: () => "job-1" });
    const svc = new InferenceService(
      port as never,
      queue,
      undefined,
      { route: () => null },
    );

    const result = svc.submitVideoJob({
      kind: "t2v",
      prompt: "犬",
      params: PARAMS,
      assets: [],
    });
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues[0]?.code).toBe("unsupported-kind");
    expect(result.issues[0]?.messageKey).toBe("media.validation.unsupportedKind");
  });
});
