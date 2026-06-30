import { IPC_CHANNELS, type AikaApi } from "@shared/ipc/contract";
import type { Job } from "@main/jobs/jobQueue";
import type {
  ImageJobRequest,
  TextGenerationResult,
  VideoJobRequest,
} from "@shared/inference/port";
import type { WritingRequest } from "@shared/writing/writingModes";
import type { AppSettings } from "@shared/settings/settings";

/**
 * preload ブリッジ。
 *
 * renderer には generateText / submitImageJob / submitVideoJob / getJob の
 * 4メソッドだけを公開し、汎用 ipcRenderer や channel 名は露出しない。
 */

/** ipcRenderer.invoke 相当の最小依存。 */
export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** contextBridge.exposeInMainWorld 相当の最小依存。 */
export interface ContextBridgeLike {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

/** window 上に公開するキー。 */
export const AIKA_API_KEY = "aika";

/**
 * invoke のみに依存する純ファクトリ。Electron 非依存でテスト可能。
 * channel 名はクロージャ内に閉じ込め、戻り値オブジェクトには現れない。
 */
export function createAikaApi(invoke: IpcInvoke): AikaApi {
  return {
    generateText: (req: WritingRequest) =>
      invoke(IPC_CHANNELS.generateText, req) as Promise<TextGenerationResult>,
    submitImageJob: (req: ImageJobRequest) =>
      invoke(IPC_CHANNELS.submitImageJob, req) as Promise<string>,
    submitVideoJob: (req: VideoJobRequest) =>
      invoke(IPC_CHANNELS.submitVideoJob, req) as Promise<string>,
    getJob: (id: string) =>
      invoke(IPC_CHANNELS.getJob, id) as Promise<Job | undefined>,
    getSettings: () =>
      invoke(IPC_CHANNELS.getSettings) as Promise<AppSettings>,
    saveSettings: (patch: Partial<AppSettings>) =>
      invoke(IPC_CHANNELS.saveSettings, patch) as Promise<AppSettings>,
  };
}

/**
 * contextBridge へ単一キー "aika" で最小 API を公開する。
 * 実際の preload では bridge=contextBridge,
 * invoke=(c, ...a) => ipcRenderer.invoke(c, ...a) を渡す。
 */
export function exposeAikaApi(
  bridge: ContextBridgeLike,
  invoke: IpcInvoke,
): void {
  bridge.exposeInMainWorld(AIKA_API_KEY, createAikaApi(invoke));
}
