import type { Job } from "@main/jobs/jobQueue";
import type { UpdateState } from "@main/update/updateManager";
import type { CodingView } from "@main/coding/codingWorkflow";
import type { JobHistoryEntry } from "@shared/jobs/jobHistory";
import type {
  ImageJobRequest,
  TextGenerationResult,
  VideoJobRequest,
} from "@shared/inference/port";
import type { WritingRequest } from "@shared/writing/writingModes";
import type { AppSettings } from "@shared/settings/settings";

/**
 * main <-> preload 間の IPC 契約。
 *
 * channel 名は内部実装の詳細であり、renderer には公開しない。
 * main 側ハンドラと preload ブリッジのみがこの定数を参照する。
 */
export const IPC_CHANNELS = {
  generateText: "aika:inference:generateText",
  submitImageJob: "aika:inference:submitImageJob",
  submitVideoJob: "aika:inference:submitVideoJob",
  getJob: "aika:jobs:getJob",
  getSettings: "aika:settings:get",
  saveSettings: "aika:settings:save",
  checkUpdate: "aika:update:check",
  planCode: "aika:coding:plan",
  executeCode: "aika:coding:execute",
  verifyCode: "aika:coding:verify",
  rewindCode: "aika:coding:rewind",
  listJobs: "aika:jobs:list",
  clearJobs: "aika:jobs:clear",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/**
 * renderer に公開する最小 API 面。
 * すべて IPC 越しのため非同期 (Promise) で統一する。
 */
export interface AikaApi {
  generateText(req: WritingRequest): Promise<TextGenerationResult>;
  submitImageJob(req: ImageJobRequest): Promise<string>;
  submitVideoJob(req: VideoJobRequest): Promise<string>;
  getJob(id: string): Promise<Job | undefined>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  checkUpdate(): Promise<UpdateState>;
  /** 目標から計画を生成し、コーディングワークフローの状態を返す。 */
  planCode(goal: string): Promise<CodingView>;
  /** planned 状態から実行し、更新後の状態を返す。 */
  executeCode(): Promise<CodingView>;
  /** executed 状態から検証し、更新後の状態を返す。 */
  verifyCode(): Promise<CodingView>;
  /** 1手戻し、更新後の状態を返す (履歴が無ければ reject)。 */
  rewindCode(): Promise<CodingView>;
  /** 完了ジョブ履歴を新しい順で返す。 */
  listJobs(): Promise<JobHistoryEntry[]>;
  /** ジョブ履歴を消去する。 */
  clearJobs(): Promise<void>;
}
