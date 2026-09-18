import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { SaveSettingsResult } from "@shared/ipc/contract";
import type { IpcMainLike } from "./registerInferenceIpc";
import type {
  AppSettings,
  LoadSettingsResult,
  SaveSettingsIntent,
} from "@shared/settings/settings";
import {
  SettingsRecoveryRequiredError,
  SettingsValidationError,
} from "@shared/settings/settings";

/**
 * 設定 IPC ハンドラ登録。preload の getSettings/saveSettings と対になる。
 */

/** SettingsService が満たす最小インターフェース。 */
export interface SettingsIpcService {
  load(): Promise<LoadSettingsResult>;
  save(
    patch: Partial<AppSettings>,
    intent?: SaveSettingsIntent,
  ): Promise<AppSettings>;
}

export function registerSettingsIpc(
  ipcMain: IpcMainLike,
  service: SettingsIpcService,
): void {
  ipcMain.handle(IPC_CHANNELS.getSettings, () => service.load());
  // patch は renderer 由来の untrusted 入力。SettingsService.save 内で検証する。
  // 例外から値への変換はこの境界だけで行い、SettingsService は throw 契約を保つ。
  ipcMain.handle(IPC_CHANNELS.saveSettings, async (_event, patch, intent) => {
    try {
      const result = await service.save(
        patch as Partial<AppSettings>,
        intent === "restore-defaults" ? "restore-defaults" : "normal",
      );
      return { status: "succeeded", result } satisfies SaveSettingsResult;
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return {
          status: "invalid",
          issues: err.violations,
        } satisfies SaveSettingsResult;
      }
      if (err instanceof SettingsRecoveryRequiredError) {
        // 既定値での上書きになる。明示の復旧操作を経ていないので書かない。
        return {
          status: "failed",
          messageKey: "settings.error.recoveryRequired",
        } satisfies SaveSettingsResult;
      }
      // 元の例外本文・stack・channel 名は renderer に渡さない。
      // throw すると Electron が "Error invoking remote method '<channel>': …"
      // を組み立てて channel 名を露出させるため、値で返す。
      return {
        status: "failed",
        messageKey: "settings.error.saveFailed",
      } satisfies SaveSettingsResult;
    }
  });
}
