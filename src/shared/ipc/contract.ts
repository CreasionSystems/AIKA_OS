import type { Job } from "@main/jobs/jobQueue";
import type { UpdateState } from "@main/update/updateManager";
import type { CodingView } from "@main/coding/codingWorkflow";
import type { JobHistoryEntry } from "@shared/jobs/jobHistory";
import type {
  ImageJobRequest,
  SubmitVideoJobResult,
  TextGenerationResult,
  VideoKind,
} from "@shared/inference/port";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";
import type {
  WritingRequest,
  WritingViolation,
} from "@shared/writing/writingModes";
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
  getVideoCapability: "aika:workflow:getVideoCapability",
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
 * 文章生成の結果 (Issue #24)。
 *
 * IPC を跨ぐと Error は name / message / stack だけの素の Error に作り直され、
 * 独自プロパティは失われる。plain object を reject しても同じで、内容は
 * `[object Object]` に潰れる。明細が境界を越えるのは resolve 経路だけのため、
 * 成功・入力不正・予期しない失敗を値で識別できるユニオンにする。
 *
 * 例外から値への変換は IPC handler だけが行い、InferenceService は
 * WritingValidationError を投げる契約のままにする。
 *
 * failed は表示用の意味 ID のみを持つ。元の例外本文・stack・channel 名などの
 * 内部情報は renderer に渡さない。
 */
export type GenerateTextResult =
  | { status: "succeeded"; result: TextGenerationResult }
  | { status: "invalid"; issues: readonly WritingViolation[] }
  | {
      status: "failed";
      messageKey: string;
      messageParams?: Readonly<Record<string, string | number>>;
    };

/**
 * renderer に公開する最小 API 面。
 * すべて IPC 越しのため非同期 (Promise) で統一する。
 */
export interface AikaApi {
  /**
   * 検証失敗は例外ではなく結果ユニオンで返す。IPC 越しでは Error の独自
   * プロパティが失われ、違反明細が renderer に届かないため (Issue #24)。
   */
  generateText(req: WritingRequest): Promise<GenerateTextResult>;
  submitImageJob(req: ImageJobRequest): Promise<string>;
  /**
   * 正規化済み要求だけを送る。main 側は受領物を信頼せず再検証し、
   * 検証失敗は例外ではなく結果ユニオンで返す (ADR-001 D6 / D9)。
   */
  submitVideoJob(req: NormalizedVideoJobRequest): Promise<SubmitVideoJobResult>;
  /**
   * 種別に対応するテンプレートの能力記述を返す。
   * 対応テンプレートが無ければ null (エラーではない)。
   */
  getVideoCapability(
    kind: VideoKind,
  ): Promise<VideoCapabilityDescriptor | null>;
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
