import { describe, it, expect } from "vitest";
import { registerJobsIpc } from "./registerJobsIpc";
import type { IpcMainLike } from "./registerInferenceIpc";
import { JobHistory } from "@shared/jobs/jobHistory";
import { createAikaApi, type IpcInvoke } from "@preload/bridge";
import { IPC_CHANNELS } from "@shared/ipc/contract";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function makeFakeIpc() {
  const handlers = new Map<string, Handler>();
  const ipcMain: IpcMainLike = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  const invoke: IpcInvoke = async (channel, ...args) => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler: ${channel}`);
    return h({}, ...args);
  };
  return { ipcMain, invoke, handlers };
}

describe("registerJobsIpc", () => {
  it("listJobs / clearJobs チャンネルを handle する", () => {
    const { ipcMain, handlers } = makeFakeIpc();
    registerJobsIpc(ipcMain, new JobHistory(5));
    expect([...handlers.keys()].sort()).toEqual(
      [IPC_CHANNELS.listJobs, IPC_CHANNELS.clearJobs].sort(),
    );
  });

  it("clearJobs は履歴を空にする", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const history = new JobHistory(5);
    history.record({ jobId: "job-1", state: "succeeded" });
    registerJobsIpc(ipcMain, history);
    const api = createAikaApi(invoke);

    await api.clearJobs();
    expect(await api.listJobs()).toEqual([]);
  });

  it("listJobs は履歴を新しい順で返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const history = new JobHistory(5);
    history.record({ jobId: "job-1", state: "succeeded" });
    history.record({ jobId: "job-2", state: "failed", error: "x" });
    registerJobsIpc(ipcMain, history);
    const api = createAikaApi(invoke);

    const list = await api.listJobs();
    expect(list.map((e) => e.jobId)).toEqual(["job-2", "job-1"]);
  });
});
