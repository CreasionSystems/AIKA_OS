import type { JobQueue, Job } from "@main/jobs/jobQueue";
import type {
  CodePlanRequest,
  CodePlanResult,
  ImageJobRequest,
  ImageJobResult,
  InferencePort,
  SubmitVideoJobResult,
  TextGenerationResult,
  VideoJobResult,
} from "@shared/inference/port";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";
import { normalizeVideoJobRequest } from "@shared/media/videoValidation";
import type { VideoCapabilityProvider } from "@main/workflow/videoCapabilities";
import { createDummyCapabilityProvider } from "@main/workflow/videoCapabilities";
import type { WorkflowRouter } from "@main/workflow/workflowRouter";
import { createDummyWorkflowRouter } from "@main/workflow/workflowRouter";
import {
  WritingValidationError,
  normalizeWritingRequest,
  validateWritingRequest,
  type WritingRequest,
} from "@shared/writing/writingModes";

/**
 * IPC ハンドラが依存する最小インターフェース。
 * 具象 InferenceService を直接束縛せず、テストでの差し替えと
 * 将来の getJob -> JobView 射影への置換余地を残す。
 */
export interface InferenceIpcService {
  generateText(req: WritingRequest): Promise<TextGenerationResult>;
  submitImageJob(req: ImageJobRequest): string;
  submitVideoJob(req: NormalizedVideoJobRequest): SubmitVideoJobResult;
  getJob(id: string): Job | undefined;
}

/**
 * InferenceService — InferencePort と JobQueue を結線する中核サービス。
 *
 * メディアジョブ (画像 / 動画) を submit* で投入すると JobQueue にジョブ化され、
 * 背後の InferencePort (DummyInferenceAdapter など差し替え可) が実行される。
 * UI / IPC はこのサービス越しに「投入 -> 監視 -> 結果取得」を行う。
 *
 * 注意: JobQueue の jobId と、アダプタが返す MediaJobResult.jobId は別系統。
 *       前者はキュー上の識別子、後者は生成バックエンド上の識別子。
 */
export class InferenceService implements InferenceIpcService {
  constructor(
    private readonly port: InferencePort,
    private readonly queue: JobQueue,
    /** UI・検証向けの能力記述。main 側の再検証にも使う。 */
    private readonly capabilities: VideoCapabilityProvider = createDummyCapabilityProvider(),
    /** 実行向けのテンプレート注入。責務が異なるため別インターフェース。 */
    private readonly router: WorkflowRouter = createDummyWorkflowRouter(),
  ) {}

  /** 画像生成ジョブを投入し、キューの jobId を返す。 */
  submitImageJob(req: ImageJobRequest): string {
    return this.queue.enqueue<ImageJobResult>(() => this.port.runImageJob(req));
  }

  /**
   * 動画生成ジョブを投入する。
   *
   * renderer 由来の入力は信頼せず、受領物から同じ共有純粋関数で再検証する
   * (ADR-001 D6)。検証に失敗した場合はキューに積まず、明細を返す。
   */
  submitVideoJob(req: NormalizedVideoJobRequest): SubmitVideoJobResult {
    // descriptor 付きで再検証する。renderer が許容外の値を送っても、
    // backend 境界で拒否できるようにする (ADR-001 D6)。
    const capability = this.capabilities.capabilityFor(req.kind);
    const result = normalizeVideoJobRequest(
      req.kind,
      { prompt: req.prompt, params: req.params, assets: req.assets },
      capability ?? undefined,
    );
    if (!result.valid) {
      return { status: "invalid", issues: result.issues };
    }

    // 検証済みの要求だけをテンプレートへ注入する。Router は値を変えない。
    const routed = this.router.route(result.request);
    if (routed === null) {
      return {
        status: "invalid",
        issues: [
          {
            code: "unsupported-kind",
            kind: req.kind,
            messageKey: "media.validation.unsupportedKind",
          },
        ],
      };
    }

    const jobId = this.queue.enqueue<VideoJobResult>(() =>
      this.port.runVideoJob({ kind: result.request.kind, ...routed }),
    );
    return { status: "accepted", jobId };
  }

  /**
   * 文章作成: validate -> normalize -> port.generateText。
   * 検証に失敗した場合は WritingValidationError を投げ、Port は呼ばない。
   *
   * 同期的な request/response のため JobQueue は経由しない。
   */
  async generateText(req: WritingRequest): Promise<TextGenerationResult> {
    const validation = validateWritingRequest(req);
    if (!validation.ok) {
      throw new WritingValidationError(validation.violations);
    }
    const normalized = normalizeWritingRequest(req);
    return this.port.generateText({
      prompt: normalized.prompt,
      mode: normalized.mode,
      maxTokens: normalized.maxTokens,
      temperature: normalized.temperature,
    });
  }

  /**
   * コーディング支援: 計画生成。port.generateCodePlan へ委譲する。
   * 空の goal は拒否する (内容レベルの検証は将来 policy 層へ)。
   */
  async generateCodePlan(req: CodePlanRequest): Promise<CodePlanResult> {
    if (req.goal.trim().length === 0) {
      throw new Error("goal が空です。");
    }
    return this.port.generateCodePlan(req);
  }

  /** ジョブ状態を取得 (未知 id は undefined)。 */
  getJob<T = unknown>(id: string): Job<T> | undefined {
    return this.queue.getJob<T>(id);
  }

  /** ジョブが succeeded/failed に到達するまで待つ。 */
  whenSettled(id: string): Promise<void> {
    return this.queue.whenSettled(id);
  }
}
