import {
  IPC_CHANNELS,
  type AikaApi,
  type GenerateTextResult,
  type SaveSettingsResult,
} from "@shared/ipc/contract";
import type { Job } from "@main/jobs/jobQueue";
import type {
  ImageJobRequest,
  SubmitVideoJobResult,
  VideoKind,
} from "@shared/inference/port";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";
import type { WritingRequest } from "@shared/writing/writingModes";
import type {
  AppSettings,
  LoadSettingsResult,
  SaveSettingsIntent,
} from "@shared/settings/settings";
import type { UpdateState } from "@main/update/updateManager";
import type { CodingView } from "@main/coding/codingWorkflow";
import type { JobHistoryEntry } from "@shared/jobs/jobHistory";

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
      invoke(IPC_CHANNELS.generateText, req) as Promise<GenerateTextResult>,
    submitImageJob: (req: ImageJobRequest) =>
      invoke(IPC_CHANNELS.submitImageJob, req) as Promise<string>,
    submitVideoJob: (req: NormalizedVideoJobRequest) =>
      invoke(
        IPC_CHANNELS.submitVideoJob,
        req,
      ) as Promise<SubmitVideoJobResult>,
    getVideoCapability: (kind: VideoKind) =>
      invoke(
        IPC_CHANNELS.getVideoCapability,
        kind,
      ) as Promise<VideoCapabilityDescriptor | null>,
    getJob: (id: string) =>
      invoke(IPC_CHANNELS.getJob, id) as Promise<Job | undefined>,
    getSettings: () =>
      invoke(IPC_CHANNELS.getSettings) as Promise<LoadSettingsResult>,
    saveSettings: (patch: Partial<AppSettings>, intent?: SaveSettingsIntent) =>
      invoke(
        IPC_CHANNELS.saveSettings,
        patch,
        intent,
      ) as Promise<SaveSettingsResult>,
    checkUpdate: () =>
      invoke(IPC_CHANNELS.checkUpdate) as Promise<UpdateState>,
    planCode: (goal: string) =>
      invoke(IPC_CHANNELS.planCode, goal) as Promise<CodingView>,
    executeCode: () =>
      invoke(IPC_CHANNELS.executeCode) as Promise<CodingView>,
    verifyCode: () =>
      invoke(IPC_CHANNELS.verifyCode) as Promise<CodingView>,
    rewindCode: () =>
      invoke(IPC_CHANNELS.rewindCode) as Promise<CodingView>,
    listJobs: () =>
      invoke(IPC_CHANNELS.listJobs) as Promise<JobHistoryEntry[]>,
    clearJobs: () => invoke(IPC_CHANNELS.clearJobs) as Promise<void>,
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
