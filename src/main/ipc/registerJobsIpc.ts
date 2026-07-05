import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { IpcMainLike } from "./registerInferenceIpc";
import type { JobHistoryEntry } from "@shared/jobs/jobHistory";

/**
 * ジョブ履歴 IPC ハンドラ登録。preload の listJobs と対になる。
 */

/** JobHistory が満たす最小インターフェース。 */
export interface JobHistoryReader {
  list(): JobHistoryEntry[];
  clear(): void;
}

export function registerJobsIpc(
  ipcMain: IpcMainLike,
  history: JobHistoryReader,
): void {
  ipcMain.handle(IPC_CHANNELS.listJobs, () => history.list());
  ipcMain.handle(IPC_CHANNELS.clearJobs, () => {
    history.clear();
  });
}
