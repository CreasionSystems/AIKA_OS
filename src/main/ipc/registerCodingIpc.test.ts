import { describe, it, expect } from "vitest";
import { registerCodingIpc } from "./registerCodingIpc";
import type { IpcMainLike } from "./registerInferenceIpc";
import { CodingWorkflow } from "@main/coding/codingWorkflow";
import { createAikaApi, type IpcInvoke } from "@preload/bridge";
import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { CodePlanResult } from "@shared/inference/port";

/**
 * コーディング IPC ハンドラ契約テスト (plan 縦切り)。
 * preload (planCode) と対になり、CodingWorkflow.plan を結線する。
 */
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
  return { ipcMain, invoke };
}

const fixedPlan: CodePlanResult = {
  summary: "Plan for: add feature",
  steps: [{ title: "Plan", detail: "分解" }],
};

describe("registerCodingIpc", () => {
  it("planCode は workflow.plan を結線し、planned 状態を返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const workflow = new CodingWorkflow({
      generateCodePlan: async () => fixedPlan,
    });
    registerCodingIpc(ipcMain, workflow);
    const api = createAikaApi(invoke);

    const state = await api.planCode("add feature");
    expect(state.phase).toBe("planned");
    expect(state.goal).toBe("add feature");
    expect(state.plan).toEqual(fixedPlan);
  });

  it("planCode チャンネルを handle する", () => {
    const { ipcMain } = makeFakeIpc();
    const handlers = new Map<string, Handler>();
    const spyIpc: IpcMainLike = {
      handle: (c, h) => {
        handlers.set(c, h);
        ipcMain.handle(c, h);
      },
    };
    registerCodingIpc(spyIpc, new CodingWorkflow({
      generateCodePlan: async () => fixedPlan,
    }));
    expect([...handlers.keys()]).toContain(IPC_CHANNELS.planCode);
  });
});
