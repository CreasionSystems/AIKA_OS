import { describe, it, expect, vi } from "vitest";
import { registerSettingsIpc } from "./registerSettingsIpc";
import type { IpcMainLike } from "./registerInferenceIpc";
import { SettingsService, DEFAULT_SETTINGS } from "@shared/settings/settings";
import { FakeSettingsStore } from "@shared/settings/fakeSettingsStore";
import { createAikaApi, type IpcInvoke } from "@preload/bridge";
import { IPC_CHANNELS } from "@shared/ipc/contract";

/**
 * 設定 IPC ハンドラ契約テスト。preload (getSettings/saveSettings) と対になる。
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

describe("registerSettingsIpc", () => {
  it("2チャンネルを handle する", () => {
    const { ipcMain, handlers } = makeFakeIpc();
    registerSettingsIpc(ipcMain, new SettingsService(new FakeSettingsStore()));
    expect([...handlers.keys()].sort()).toEqual(
      [IPC_CHANNELS.getSettings, IPC_CHANNELS.saveSettings].sort(),
    );
  });

  it("getSettings は既定値を返し、saveSettings 後に反映される (往復)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const store = new FakeSettingsStore();
    registerSettingsIpc(ipcMain, new SettingsService(store));
    const api = createAikaApi(invoke);

    expect(await api.getSettings()).toEqual(DEFAULT_SETTINGS);

    const saved = await api.saveSettings({ theme: "dark" });
    expect(saved.theme).toBe("dark");
    expect((await api.getSettings()).theme).toBe("dark");
  });

  it("save は service へ委譲する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const service = new SettingsService(new FakeSettingsStore());
    const spy = vi.spyOn(service, "save");
    registerSettingsIpc(ipcMain, service);
    const api = createAikaApi(invoke);

    await api.saveSettings({ jobHistoryLimit: 5 });
    expect(spy).toHaveBeenCalledWith({ jobHistoryLimit: 5 });
  });
});
