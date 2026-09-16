import { describe, it, expect, vi } from "vitest";
import { registerWorkflowIpc } from "./registerWorkflowIpc";
import { IPC_CHANNELS } from "@shared/ipc/contract";
import { createDummyCapabilityProvider } from "@main/workflow/videoCapabilities";
import type { IpcMainLike } from "./registerInferenceIpc";

/**
 * PR-F1: 用途を限定した capability 供給 IPC。
 *
 * 汎用の取得 API にはせず、動画種別の能力記述だけを返す。
 */
function makeFakeIpc() {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  const ipcMain: IpcMainLike = {
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
  };
  return { ipcMain, handlers };
}

describe("registerWorkflowIpc", () => {
  it("capability 用の1チャネルだけを登録する", () => {
    const { ipcMain, handlers } = makeFakeIpc();
    registerWorkflowIpc(ipcMain, createDummyCapabilityProvider());
    expect([...handlers.keys()]).toEqual([IPC_CHANNELS.getVideoCapability]);
  });

  it("kind を provider へ委譲し、descriptor を返す", async () => {
    const { ipcMain, handlers } = makeFakeIpc();
    const provider = { capabilityFor: vi.fn(() => null) };
    registerWorkflowIpc(ipcMain, provider);

    const result = await handlers.get(IPC_CHANNELS.getVideoCapability)?.(
      {},
      "i2v",
    );
    expect(provider.capabilityFor).toHaveBeenCalledWith("i2v");
    expect(result).toBeNull();
  });

  it("未知の kind でも例外にせず null を返せる", async () => {
    const { ipcMain, handlers } = makeFakeIpc();
    registerWorkflowIpc(ipcMain, { capabilityFor: () => null });
    // ハンドラは同期で null を返す (例外にしない)。
    expect(
      handlers.get(IPC_CHANNELS.getVideoCapability)?.({}, "unknown"),
    ).toBeNull();
  });
});
