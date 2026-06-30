/**
 * InferencePort — 推論基盤への唯一の境界 (Ports & Adapters)。
 *
 * UI / ジョブ管理 / 状態遷移 / エラーハンドリングはこの Port にのみ依存し、
 * 実体 (DummyInferenceAdapter / OllamaInferenceAdapter / ComfyUIVideoAdapter /
 * ImageGenerationAdapter) を差し替え可能にする。
 *
 * shared に置くことで、型契約を main / preload / renderer から共有する。
 */

/** 文章作成モード (一般 / 小説 / 歌詞 / 仕事の書類 / 法務文章)。 */
export type WritingMode = "general" | "novel" | "lyrics" | "business" | "legal";

/** 動画生成の種別 (T2V / I2V / 継続 / 編集 / 音声駆動)。 */
export type VideoKind = "t2v" | "i2v" | "continuation" | "edit" | "audio";

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  /** アダプタ識別子 (例: "dummy", "ollama")。 */
  adapter: string;
  detail?: string;
}

export interface TextGenerationRequest {
  prompt: string;
  mode?: WritingMode;
  maxTokens?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface TextGenerationResult {
  text: string;
  finishReason: "stop" | "length";
  model: string;
  usage: TokenUsage;
}

export interface CodePlanRequest {
  goal: string;
  context?: string;
}

export interface CodePlanStep {
  title: string;
  detail: string;
}

export interface CodePlanResult {
  summary: string;
  steps: CodePlanStep[];
}

export interface ImageJobRequest {
  prompt: string;
  model?: string;
}

export interface VideoJobRequest {
  kind: VideoKind;
  prompt?: string;
  sourceImage?: string;
}

/** ジョブ結果の共通形。実体のないFakeでもUIが扱えるように構造を固定する。 */
export interface MediaJobResult {
  jobId: string;
  status: "succeeded" | "failed";
  /** 生成を担ったバックエンド識別子 (Fake は "dummy")。 */
  backend: string;
  /**
   * 生成物への参照。
   *
   * 暫定契約: 各要素は「ローカル絶対パス」(POSIX 絶対パス) とする。
   * 将来は構造化型 (ArtifactDescriptor: 種別 / パス / MIME / メタ) への
   * 置換を前提とする。それまで上位はこの意味に依存してよい。
   */
  artifacts: string[];
}

export interface ImageJobResult extends MediaJobResult {}

export interface VideoJobResult extends MediaJobResult {
  kind: VideoKind;
}

/** 推論基盤への唯一の境界。全アダプタが実装する。 */
export interface InferencePort {
  healthCheck(): Promise<HealthStatus>;
  generateText(req: TextGenerationRequest): Promise<TextGenerationResult>;
  generateCodePlan(req: CodePlanRequest): Promise<CodePlanResult>;
  runImageJob(req: ImageJobRequest): Promise<ImageJobResult>;
  runVideoJob(req: VideoJobRequest): Promise<VideoJobResult>;
}
