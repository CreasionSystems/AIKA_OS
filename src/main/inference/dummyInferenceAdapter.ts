import type {
  CodePlanRequest,
  CodePlanResult,
  HealthStatus,
  ImageJobRequest,
  ImageJobResult,
  InferencePort,
  TextGenerationRequest,
  TextGenerationResult,
  VideoJobRequest,
  VideoJobResult,
} from "@shared/inference/port";

/**
 * DummyInferenceAdapter — InferencePort を満たす正式な Fake。
 *
 * 固定 (決定的) レスポンス + 擬似遅延を返し、本物の推論基盤なしで
 * 上位 (UI / ジョブ管理 / 状態遷移 / エラーハンドリング) を完成させる。
 *
 * sleep / idFactory は注入可能。テストは待たずに決定的に検証できる。
 */

export interface DummyInferenceAdapterOptions {
  /** 各呼び出しで挟む擬似遅延 (ms)。 */
  delayMs?: number;
  /** 注入用 sleep。既定は実時間 setTimeout。 */
  sleep?: (ms: number) => Promise<void>;
  /** ジョブ ID 生成。既定はインスタンス内の連番。 */
  idFactory?: () => string;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ざっくりしたトークン概算 (決定的)。 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class DummyInferenceAdapter implements InferencePort {
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly idFactory: () => string;

  constructor(options: DummyInferenceAdapterOptions = {}) {
    this.delayMs = options.delayMs ?? 50;
    this.sleep = options.sleep ?? realSleep;
    this.idFactory = options.idFactory ?? this.defaultIdFactory();
  }

  private defaultIdFactory(): () => string {
    let n = 0;
    return () => `dummy-job-${++n}`;
  }

  async healthCheck(): Promise<HealthStatus> {
    await this.sleep(this.delayMs);
    return { status: "ok", adapter: "dummy", detail: "fixed fake response" };
  }

  async generateText(
    req: TextGenerationRequest,
  ): Promise<TextGenerationResult> {
    await this.sleep(this.delayMs);
    const mode = req.mode ?? "general";
    const text = `[dummy:${mode}] ${req.prompt}`;
    return {
      text,
      finishReason: "stop",
      model: "dummy-text-v0",
      usage: {
        promptTokens: estimateTokens(req.prompt),
        completionTokens: estimateTokens(text),
      },
    };
  }

  async generateCodePlan(req: CodePlanRequest): Promise<CodePlanResult> {
    await this.sleep(this.delayMs);
    return {
      summary: `Plan for: ${req.goal}`,
      steps: [
        { title: "Plan", detail: `目標を分解する: ${req.goal}` },
        { title: "Execute", detail: "最小差分を実装する" },
        { title: "Verify", detail: "テストで検証する" },
      ],
    };
  }

  async runImageJob(_req: ImageJobRequest): Promise<ImageJobResult> {
    await this.sleep(this.delayMs);
    const jobId = this.idFactory();
    // 暫定契約: artifacts はローカル絶対パス。
    return {
      jobId,
      status: "succeeded",
      backend: "dummy",
      artifacts: [`/var/lib/aika/artifacts/${jobId}.png`],
    };
  }

  async runVideoJob(req: VideoJobRequest): Promise<VideoJobResult> {
    await this.sleep(this.delayMs);
    const jobId = this.idFactory();
    return {
      jobId,
      status: "succeeded",
      backend: "dummy",
      kind: req.kind,
      artifacts: [`/var/lib/aika/artifacts/${jobId}.${req.kind}.mp4`],
    };
  }
}
