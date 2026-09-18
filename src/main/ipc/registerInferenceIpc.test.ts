import { describe, it, expect, vi } from "vitest";
import {
  registerInferenceIpc,
  type IpcMainLike,
} from "./registerInferenceIpc";
import {
  InferenceService,
  type InferenceIpcService,
} from "@main/inference/inferenceService";
import { DummyInferenceAdapter } from "@main/inference/dummyInferenceAdapter";
import { JobQueue, type Job } from "@main/jobs/jobQueue";
import { createAikaApi, type IpcInvoke } from "@preload/bridge";
import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { TextGenerationResult } from "@shared/inference/port";
import { WritingValidationError } from "@shared/writing/writingModes";

/**
 * main 側 IPC ハンドラ契約テスト。
 *
 * 固定する契約:
 *  - IPC_CHANNELS の4チャンネルを ipcMain.handle で登録する。
 *  - 各ハンドラは引数を InferenceService の該当メソッドへ委譲し、結果を返す。
 *  - preload (createAikaApi) と対になり、main<->preload が型で閉じる。
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function makeFakeIpc() {
  const handlers = new Map<string, Handler>();
  const ipcMain: IpcMainLike = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  // handlers を invoke として橋渡しする (preload 側と接続)。
  const invoke: IpcInvoke = async (channel, ...args) => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler for channel: ${channel}`);
    return h({}, ...args);
  };
  return { ipcMain, invoke, handlers };
}

function makeClock(start = 0) {
  let t = start;
  return () => ++t;
}

function makeRealService() {
  const adapter = new DummyInferenceAdapter({
    delayMs: 0,
    sleep: async () => {},
    idFactory: (() => {
      let n = 0;
      return () => `media-${++n}`;
    })(),
  });
  const queue = new JobQueue({ now: makeClock(), idFactory: () => "job-1" });
  return new InferenceService(adapter, queue);
}

/** 委譲検証用の記録サービス。 */
function makeRecordingService() {
  const calls: { method: string; args: unknown[] }[] = [];
  const service: InferenceIpcService = {
    generateText: vi.fn(async (req) => {
      calls.push({ method: "generateText", args: [req] });
      return {
        text: "ok",
        finishReason: "stop",
        model: "rec",
        usage: { promptTokens: 1, completionTokens: 1 },
      } satisfies TextGenerationResult;
    }),
    submitImageJob: vi.fn((req) => {
      calls.push({ method: "submitImageJob", args: [req] });
      return "img-job";
    }),
    submitVideoJob: vi.fn(
      async (req): Promise<{ status: "accepted"; jobId: string }> => {
        calls.push({ method: "submitVideoJob", args: [req] });
        return { status: "accepted", jobId: "vid-job" };
      },
    ),
    getJob: vi.fn((id): Job | undefined => {
      calls.push({ method: "getJob", args: [id] });
      return { id, state: "queued", createdAt: 0 };
    }),
  };
  return { service, calls };
}

describe("registerInferenceIpc: 登録", () => {
  it("4チャンネルすべてを handle する", () => {
    const { ipcMain, handlers } = makeFakeIpc();
    const { service } = makeRecordingService();
    registerInferenceIpc(ipcMain, service);
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC_CHANNELS.generateText,
        IPC_CHANNELS.getJob,
        IPC_CHANNELS.submitImageJob,
        IPC_CHANNELS.submitVideoJob,
      ].sort(),
    );
  });
});

describe("registerInferenceIpc: 委譲", () => {
  it("各ハンドラは service へ引数を委譲する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const { service, calls } = makeRecordingService();
    registerInferenceIpc(ipcMain, service);

    await invoke(IPC_CHANNELS.generateText, { mode: "general", prompt: "x" });
    await invoke(IPC_CHANNELS.submitImageJob, { prompt: "a" });
    await invoke(IPC_CHANNELS.submitVideoJob, { kind: "t2v" });
    await invoke(IPC_CHANNELS.getJob, "job-1");

    expect(calls.map((c) => c.method)).toEqual([
      "generateText",
      "submitImageJob",
      "submitVideoJob",
      "getJob",
    ]);
    expect(calls[3]?.args).toEqual(["job-1"]);
  });
});

describe("main<->preload 往復 (型付き境界)", () => {
  it("createAikaApi 経由で generateText が通る", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerInferenceIpc(ipcMain, makeRealService());
    const api = createAikaApi(invoke);

    const res = await api.generateText({ mode: "general", prompt: "hi" });
    expect(res.status).toBe("succeeded");
    if (res.status !== "succeeded") return;
    expect(res.result.text).toContain("general"); // dummy: "[dummy:general] hi"
  });

  it("submitImageJob -> getJob が往復して succeeded になる", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerInferenceIpc(ipcMain, makeRealService());
    const api = createAikaApi(invoke);

    const id = await api.submitImageJob({ prompt: "a cat" });
    expect(id).toBe("job-1");

    await new Promise((r) => setTimeout(r, 0)); // 処理完了を待つ
    const job = await api.getJob(id);
    expect(job?.state).toBe("succeeded");
  });
});

/**
 * Issue #24: generateText の失敗を、IPC 境界で結果ユニオンへ変換する。
 *
 * Electron の invoke は reject 値を name / message / stack だけの Error に
 * 作り直すため、throw では violations が renderer に届かない。明細が越えるのは
 * resolve 経路だけなので、handler が値へ変換する。
 */
describe("generateText: IPC 境界での結果ユニオン化 (Issue #24)", () => {
  /** generateText だけを差し替えた最小サービス。 */
  function serviceWith(
    generateText: InferenceIpcService["generateText"],
  ): InferenceIpcService {
    return {
      generateText,
      submitImageJob: () => "img-job",
      submitVideoJob: async () => ({ status: "accepted", jobId: "vid-job" }),
      getJob: () => undefined,
    };
  }

  const VIOLATIONS = [
    { code: "EMPTY_PROMPT" as const, messageKey: "writing.validation.emptyPrompt" },
    {
      code: "TEMPERATURE_NOT_ALLOWED" as const,
      messageKey: "writing.validation.temperatureNotAllowed",
      messageParams: { mode: "business", max: 0.6 },
    },
  ];

  it("成功は succeeded として結果を包んで返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerInferenceIpc(ipcMain, makeRealService());
    const res = await invoke(IPC_CHANNELS.generateText, {
      mode: "general",
      prompt: "hi",
    });
    expect(res).toMatchObject({ status: "succeeded" });
  });

  it("WritingValidationError は reject せず invalid を resolve する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerInferenceIpc(
      ipcMain,
      serviceWith(async () => {
        throw new WritingValidationError([...VIOLATIONS]);
      }),
    );

    // reject しないこと自体が契約。
    const res = (await invoke(IPC_CHANNELS.generateText, {
      mode: "business",
      prompt: "",
    })) as { status: string; issues: readonly { code: string }[] };

    expect(res.status).toBe("invalid");
  });

  it("issues の code と messageKey が保持される", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerInferenceIpc(
      ipcMain,
      serviceWith(async () => {
        throw new WritingValidationError([...VIOLATIONS]);
      }),
    );
    const res = (await invoke(IPC_CHANNELS.generateText, {
      mode: "business",
      prompt: "",
    })) as { status: string; issues: readonly Record<string, unknown>[] };

    expect(res.issues).toEqual(VIOLATIONS);
    expect(res.issues.map((i) => i.code)).toEqual([
      "EMPTY_PROMPT",
      "TEMPERATURE_NOT_ALLOWED",
    ]);
    expect(res.issues[0]?.messageKey).toBe("writing.validation.emptyPrompt");
    // 補間値も落ちない。
    expect(res.issues[1]?.messageParams).toEqual({ mode: "business", max: 0.6 });
  });

  it("予期しない例外は failed になり、内部情報を含まない", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerInferenceIpc(
      ipcMain,
      serviceWith(async () => {
        throw new Error("backend exploded at /Users/secret/path.ts:42");
      }),
    );
    const res = (await invoke(IPC_CHANNELS.generateText, {
      mode: "general",
      prompt: "hi",
    })) as Record<string, unknown>;

    expect(res.status).toBe("failed");
    expect(res.messageKey).toBe("writing.error.generationFailed");

    // 元の例外本文・stack・channel 名のいずれも渡さない。
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("backend exploded");
    expect(serialized).not.toContain("/Users/secret");
    expect(serialized).not.toContain("aika:inference:");
    expect(serialized).not.toContain("Error invoking remote method");
    expect(Object.keys(res).sort()).toEqual(["messageKey", "status"]);
  });

  it("failed でも reject しない (renderer が生の Error を受け取らない)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerInferenceIpc(
      ipcMain,
      serviceWith(async () => {
        throw new Error("boom");
      }),
    );
    await expect(
      invoke(IPC_CHANNELS.generateText, { mode: "general", prompt: "hi" }),
    ).resolves.toMatchObject({ status: "failed" });
  });
});
