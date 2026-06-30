import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { IpcMainLike } from "./registerInferenceIpc";
import type { UpdateState } from "@main/update/updateManager";

/**
 * 更新 IPC ハンドラ登録。preload の checkUpdate と対になる。
 * 確認のみ (ダウンロード・適用は後続)。
 */

/** UpdateManager が満たす最小インターフェース。 */
export interface UpdateIpcManager {
  check(): Promise<UpdateState>;
}

export function registerUpdateIpc(
  ipcMain: IpcMainLike,
  manager: UpdateIpcManager,
): void {
  ipcMain.handle(IPC_CHANNELS.checkUpdate, () => manager.check());
}
