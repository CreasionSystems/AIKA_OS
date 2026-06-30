import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { IpcMainLike } from "./registerInferenceIpc";
import type { AppSettings } from "@shared/settings/settings";

/**
 * 設定 IPC ハンドラ登録。preload の getSettings/saveSettings と対になる。
 */

/** SettingsService が満たす最小インターフェース。 */
export interface SettingsIpcService {
  load(): Promise<AppSettings>;
  save(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export function registerSettingsIpc(
  ipcMain: IpcMainLike,
  service: SettingsIpcService,
): void {
  ipcMain.handle(IPC_CHANNELS.getSettings, () => service.load());
  // patch は renderer 由来の untrusted 入力。SettingsService.save 内で検証する。
  ipcMain.handle(IPC_CHANNELS.saveSettings, (_event, patch) =>
    service.save(patch as Partial<AppSettings>),
  );
}
