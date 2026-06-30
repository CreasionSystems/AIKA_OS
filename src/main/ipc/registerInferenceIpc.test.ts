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
    submitVideoJob: vi.fn((req) => {
      calls.push({ method: "submitVideoJob", args: [req] });
      return "vid-job";
    }),
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
    expect(res.text).toContain("general"); // dummy: "[dummy:general] hi"
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
