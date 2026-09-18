import { IPC_CHANNELS } from "@shared/ipc/contract";
import type { GenerateTextResult } from "@shared/ipc/contract";
import type { InferenceIpcService } from "@main/inference/inferenceService";
import type { ImageJobRequest } from "@shared/inference/port";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";
import type { WritingRequest } from "@shared/writing/writingModes";
import { WritingValidationError } from "@shared/writing/writingModes";

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
  // 例外から値への変換はこの境界だけで行う。InferenceService は
  // WritingValidationError を投げる契約のまま維持する (Issue #24)。
  ipcMain.handle(IPC_CHANNELS.generateText, async (_event, req) => {
    try {
      const result = await service.generateText(req as WritingRequest);
      return { status: "succeeded", result } satisfies GenerateTextResult;
    } catch (err) {
      if (err instanceof WritingValidationError) {
        return {
          status: "invalid",
          issues: err.violations,
        } satisfies GenerateTextResult;
      }
      // 元の例外本文・stack・channel 名は renderer に渡さない。
      // throw すると Electron が "Error invoking remote method '<channel>': …"
      // を組み立てて channel 名を露出させるため、値で返す。
      return {
        status: "failed",
        messageKey: "writing.error.generationFailed",
      } satisfies GenerateTextResult;
    }
  });
  ipcMain.handle(IPC_CHANNELS.submitImageJob, (_event, req) =>
    service.submitImageJob(req as ImageJobRequest),
  );
  ipcMain.handle(IPC_CHANNELS.submitVideoJob, (_event, req) =>
    // 受領物は untrusted。service 側が共有純粋関数で再検証する。
    service.submitVideoJob(req as NormalizedVideoJobRequest),
  );
  ipcMain.handle(IPC_CHANNELS.getJob, (_event, id) =>
    service.getJob(id as string),
  );
}
