import type { ValidationIssue } from "@shared/media/videoValidation";
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
  /** サンプリング温度。文章作成モードの上限に従う (writingModes 参照)。 */
  temperature?: number;
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

/**
 * 動画ジョブ投入の結果 (ADR-001 D9)。
 *
 * 検証失敗は throw ではなくユニオンで返す。IPC を跨ぐと Error の
 * カスタムプロパティは structured clone で失われ、明細が届かないため。
 * 想定外の失敗 (キュー障害など) のみ reject する。
 */
export type SubmitVideoJobResult =
  | { status: "accepted"; jobId: string }
  | { status: "invalid"; issues: readonly ValidationIssue[] };

/**
 * Workflow Router の出力。テンプレート識別子と注入済みの入力。
 *
 * inputs のキーはテンプレートごとに異なるため、共有契約では固定しない
 * (ADR-001 D3b と同じ思想)。正準キーは Router 実装とそのテストで固定する。
 */
export interface RoutedWorkflow {
  templateId: string;
  inputs: Readonly<Record<string, unknown>>;
}

/**
 * アダプタの実行契約。Router の出力に kind を添えたもの。
 *
 * 旧 VideoJobRequest (prompt と sourceImage だけ) を置き換える。旧契約では
 * params と image 以外の assets が落ちていた。
 */
export type RoutedVideoJob = { kind: VideoKind } & RoutedWorkflow;

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
  runVideoJob(req: RoutedVideoJob): Promise<VideoJobResult>;
}
