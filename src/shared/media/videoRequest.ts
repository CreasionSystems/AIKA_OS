/**
 * 動画生成要求のドメイン型 (Renderer / Main 共有)。
 *
 * ADR-001: 動画生成 UI は「自然文 + 構造化パラメータ」のハイブリッド。
 * 補完ポートが返すパラメータは候補であり、そのまま実行値にしない。
 * ユーザー確認を経た VideoDraft を正規化して NormalizedVideoJobRequest を作り、
 * それだけを IPC へ渡す。
 */

import type { VideoKind } from "@shared/inference/port";

/** 出力サイズの意図。品質プリセットとは直交する (ADR-001 D3d)。 */
export type Resolution = "480p" | "720p" | "1080p";

/** 品質・計算量・workflow variant の意図。解像度の別名ではない。 */
export type QualityPreset = "draft" | "standard" | "high";

/** 動画生成の構造化パラメータ。値域はモデルごとに異なるため型には埋め込まない。 */
export interface VideoGenerationParams {
  /** 秒。既定値は 5 (共通の上限は設けない: ADR-001 D3b)。 */
  durationSec: number;
  /** 正の整数。許容値は capability の allowedFps で決まる。 */
  fps: number;
  resolution: Resolution;
  qualityPreset: QualityPreset;
  /**
   * 0.0–1.0 の正規化値。AIKA_OS の UI 意味論であり、モデル固有値
   * (SVD の motion_bucket_id 1–255、AnimateDiff の motion scale 等) とは
   * 意味が異なる。写像は Router / capability 側の責務。
   */
  motionStrength: number;
}

/** 参照画像 / 元動画 / 音声。役割 (first-frame, mask 等) は後続 PR で導入する。 */
export interface LocalMediaAsset {
  kind: "image" | "video" | "audio";
  /** ローカル絶対パス。renderer 由来の値は Main 側で必ず再検証する。 */
  path: string;
}

/** UI 既定値。capability が許さない場合は検証で弾く (黙って丸めない)。 */
export const DEFAULT_DURATION_SEC = 5;
/** UI 既定値。0.0–1.0 の中央。 */
export const DEFAULT_MOTION_STRENGTH = 0.5;

/** 編集中の下書き。不足項目を表現するため params は Partial。 */
export interface VideoDraft {
  prompt: string;
  params: Partial<VideoGenerationParams>;
  assets: readonly LocalMediaAsset[];
}

/** 正規化・検証を通過した送信可能な要求。IPC へはこれだけを渡す。 */
export interface NormalizedVideoJobRequest {
  kind: VideoKind;
  prompt: string;
  params: VideoGenerationParams;
  assets: readonly LocalMediaAsset[];
}
