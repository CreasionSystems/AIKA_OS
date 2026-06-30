import { describe, it, expect } from "vitest";
import { registerUpdateIpc } from "./registerUpdateIpc";
import type { IpcMainLike } from "./registerInferenceIpc";
import {
  UpdateManager,
  FakeUpdateChecker,
} from "@main/update/updateManager";
import { createAikaApi, type IpcInvoke } from "@preload/bridge";
import { IPC_CHANNELS } from "@shared/ipc/contract";

/**
 * 更新 IPC ハンドラ契約テスト。preload (checkUpdate) と対になる。
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
  return { ipcMain, invoke, handlers };
}

describe("registerUpdateIpc", () => {
  it("checkUpdate チャンネルを handle する", () => {
    const { ipcMain, handlers } = makeFakeIpc();
    registerUpdateIpc(ipcMain, new UpdateManager(new FakeUpdateChecker(null)));
    expect([...handlers.keys()]).toEqual([IPC_CHANNELS.checkUpdate]);
  });

  it("更新ありなら available + info を返す (往復)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const mgr = new UpdateManager(
      new FakeUpdateChecker({ version: "2.0.0" }),
    );
    registerUpdateIpc(ipcMain, mgr);
    const api = createAikaApi(invoke);

    const state = await api.checkUpdate();
    expect(state.phase).toBe("available");
    expect(state.info?.version).toBe("2.0.0");
  });

  it("更新なしなら up-to-date を返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerUpdateIpc(ipcMain, new UpdateManager(new FakeUpdateChecker(null)));
    const api = createAikaApi(invoke);

    expect((await api.checkUpdate()).phase).toBe("up-to-date");
  });
});
