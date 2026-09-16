/**
 * 動画生成テンプレート / モデルの能力記述 (Renderer / Main 共有)。
 *
 * ADR-001 D3b: durationSec / fps の許容値はモデルごとに異なり共通集合を作れない
 * (Wan 2.1 は 16fps 中心、LTX-Video は 24/30fps、SVD は 6fps 前後)。
 * したがって値域を型にも共通定数にも埋め込まず、「要求値 + 能力記述」を受け取る
 * 純粋関数で検証する。
 *
 * 本モジュールは抽象契約とモード単位の既定値までを持つ。個別モデル
 * (Wan / LTX / SVD 等) の concrete descriptor と Router 接続は後続 PR。
 */

import type { VideoKind } from "@shared/inference/port";
import type {
  LocalMediaAsset,
  QualityPreset,
  Resolution,
} from "./videoRequest";

/** prompt の必須性。VideoKind に固定せず descriptor で変更できる。 */
export type PromptRequirement = "required" | "optional" | "forbidden";

/** 資産の種別ごとの個数要件。tuple で固定せず個数で表現する。 */
export interface AssetRequirement {
  kind: LocalMediaAsset["kind"];
  min: number;
  /** 省略時は上限なし。 */
  max?: number;
}

/**
 * 有効なフレーム数の規則。
 *
 * 実モデルはフレーム数で制約を持つ (Wan 2.1 は 4n+1、LTX-Video は 8n+1)。
 * 秒と fps の積がこの規則を満たさない場合、黙って丸めず検証エラーにする。
 */
export type FrameCountRule =
  | { kind: "exact"; frameCount: number }
  | { kind: "range"; min: number; max: number; step?: number }
  | {
      kind: "modulo";
      /** frameCount % modulus === remainder を要求する。 */
      modulus: number;
      remainder: number;
      min?: number;
      max?: number;
    };

/** 解像度と品質プリセットの実行可能な組み合わせ。 */
export interface ResolutionQualityPair {
  resolution: Resolution;
  qualityPreset: QualityPreset;
}

/** テンプレート / モデルが受け付けられる入力の記述。 */
export interface VideoCapabilityDescriptor {
  allowedFps: readonly number[];
  durationSec: {
    min: number;
    max: number;
    /** 離散的な選択肢しか持たない場合に指定する。 */
    allowed?: readonly number[];
  };
  frameCount: FrameCountRule;
  supportedResolutions: readonly Resolution[];
  supportedQualityPresets: readonly QualityPreset[];
  /** 省略時は supportedResolutions × supportedQualityPresets の全組み合わせを許す。 */
  resolutionQualityPairs?: readonly ResolutionQualityPair[];
  promptRequirement: PromptRequirement;
  assetRequirements: readonly AssetRequirement[];
}

/**
 * モード単位の prompt 既定要件 (ADR-001 D9b)。
 *
 * 全モード必須にはしない。SVD のように画像・motion bucket・fps を中心に動作し、
 * テキスト prompt を取らないモデルがあるため。descriptor で上書きできる。
 */
export const DEFAULT_PROMPT_REQUIREMENT: Readonly<
  Record<VideoKind, PromptRequirement>
> = {
  t2v: "required",
  i2v: "optional",
  continuation: "optional",
  edit: "required",
  audio: "optional",
};

/**
 * モード単位の資産既定要件 (ADR-001 D9b)。
 *
 * audio の image を共通契約では必須にしない。音声のみから生成する / 音声と動画を
 * 再編集する / 画像を内部生成するテンプレートを排除しないため。画像必須は
 * 個別の descriptor が宣言する。
 */
export const DEFAULT_ASSET_REQUIREMENTS: Readonly<
  Record<VideoKind, readonly AssetRequirement[]>
> = {
  t2v: [],
  i2v: [{ kind: "image", min: 1, max: 1 }],
  continuation: [{ kind: "video", min: 1, max: 1 }],
  edit: [{ kind: "video", min: 1, max: 1 }],
  audio: [
    { kind: "audio", min: 1, max: 1 },
    { kind: "image", min: 0, max: 1 },
  ],
};
