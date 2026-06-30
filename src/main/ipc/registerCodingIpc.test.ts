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

  it("executeCode は planned の後に executed + executionLog を返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const workflow = new CodingWorkflow({
      generateCodePlan: async () => fixedPlan,
    });
    registerCodingIpc(ipcMain, workflow);
    const api = createAikaApi(invoke);

    await api.planCode("add feature");
    const state = await api.executeCode();
    expect(state.phase).toBe("executed");
    expect(state.executionLog?.length).toBeGreaterThan(0);
  });

  it("未計画時の executeCode は reject する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerCodingIpc(
      ipcMain,
      new CodingWorkflow({ generateCodePlan: async () => fixedPlan }),
    );
    const api = createAikaApi(invoke);
    await expect(api.executeCode()).rejects.toThrow(/planned/);
  });

  it("verifyCode は executed の後に verified + verification を返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const workflow = new CodingWorkflow({
      generateCodePlan: async () => fixedPlan,
    });
    registerCodingIpc(ipcMain, workflow);
    const api = createAikaApi(invoke);

    await api.planCode("add feature");
    await api.executeCode();
    const state = await api.verifyCode();
    expect(state.phase).toBe("verified");
    expect(state.verification?.passed).toBe(true);
  });

  it("未実行時の verifyCode は reject する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const workflow = new CodingWorkflow({
      generateCodePlan: async () => fixedPlan,
    });
    registerCodingIpc(ipcMain, workflow);
    const api = createAikaApi(invoke);
    await api.planCode("g");
    await expect(api.verifyCode()).rejects.toThrow(/executed/);
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
