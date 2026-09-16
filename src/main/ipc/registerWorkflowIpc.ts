import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { VideoKind } from "@shared/inference/port";
import type { VideoCapabilityProvider } from "@main/workflow/videoCapabilities";
import type { IpcMainLike } from "./registerInferenceIpc";

/**
 * ワークフロー境界の IPC 登録。
 *
 * 用途を限定した API のみを公開する。テンプレート本体や JSON 構造は渡さず、
 * renderer が必要とする「何が選べるか」= VideoCapabilityDescriptor だけを返す。
 */
export function registerWorkflowIpc(
  ipcMain: IpcMainLike,
  provider: VideoCapabilityProvider,
): void {
  // 注意: kind は renderer 由来の untrusted 入力。provider 側で未知の値には
  // null を返し、例外にしない (「対応テンプレートが無い」は入力の不正ではない)。
  ipcMain.handle(IPC_CHANNELS.getVideoCapability, (_event, kind) =>
    provider.capabilityFor(kind as VideoKind),
  );
}
