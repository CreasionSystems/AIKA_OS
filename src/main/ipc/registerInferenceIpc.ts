import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { InferenceIpcService } from "@main/inference/inferenceService";
import type { ImageJobRequest, VideoJobRequest } from "@shared/inference/port";
import type { WritingRequest } from "@shared/writing/writingModes";

/**
 * main 側 IPC ハンドラ登録。preload の AikaApi と対になる境界。
 *
 * ipcMain.handle(channel, ...) で IPC_CHANNELS を InferenceService へ委譲する。
 * Electron 非依存にするため最小インターフェース IpcMainLike に依存する。
 */

/** ipcMain.handle 相当の最小依存。 */
export interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
}

export function registerInferenceIpc(
  ipcMain: IpcMainLike,
  service: InferenceIpcService,
): void {
  // 注意: args は renderer 由来の untrusted 入力。
  // 現時点は型アサーションで受け、ランタイム検証は将来の policy 層へ分離する。
  ipcMain.handle(IPC_CHANNELS.generateText, (_event, req) =>
    service.generateText(req as WritingRequest),
  );
  ipcMain.handle(IPC_CHANNELS.submitImageJob, (_event, req) =>
    service.submitImageJob(req as ImageJobRequest),
  );
  ipcMain.handle(IPC_CHANNELS.submitVideoJob, (_event, req) =>
    service.submitVideoJob(req as VideoJobRequest),
  );
  ipcMain.handle(IPC_CHANNELS.getJob, (_event, id) =>
    service.getJob(id as string),
  );
}
