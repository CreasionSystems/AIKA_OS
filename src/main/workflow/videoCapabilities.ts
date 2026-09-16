import type { VideoKind } from "@shared/inference/port";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";
import {
  DEFAULT_ASSET_REQUIREMENTS,
  DEFAULT_PROMPT_REQUIREMENT,
} from "@shared/media/videoCapability";

/**
 * 動画テンプレートの能力記述を供給する (main 側)。
 *
 * ADR-001 D2: テンプレート知識は Router 側に閉じる。renderer へ渡すのは
 * 「何が選べるか」を表す VideoCapabilityDescriptor だけで、templateId の
 * 中身や JSON 構造は渡さない。
 *
 * 現時点は Dummy アダプタ相当の1種のみ。Wan / LTX / SVD の実測値に基づく
 * descriptor は ComfyUI 接続時に別 PR で追加する。
 */
export interface VideoCapabilityProvider {
  /** kind に対応する能力記述。対応テンプレートが無ければ null (エラーではない)。 */
  capabilityFor(kind: VideoKind): VideoCapabilityDescriptor | null;
}

/** Dummy バックエンド相当の能力記述。16fps 中心 / 4n+1 フレーム。 */
function dummyDescriptor(kind: VideoKind): VideoCapabilityDescriptor {
  return {
    allowedFps: [8, 16, 24],
    durationSec: { min: 1, max: 8 },
    // 実モデルはフレーム数で制約を持つ (Wan は 4n+1)。Dummy でも同じ形で表す。
    frameCount: { kind: "modulo", modulus: 4, remainder: 1, min: 5, max: 129 },
    supportedResolutions: ["480p", "720p"],
    supportedQualityPresets: ["draft", "standard", "high"],
    promptRequirement: DEFAULT_PROMPT_REQUIREMENT[kind],
    assetRequirements: DEFAULT_ASSET_REQUIREMENTS[kind],
    defaults: {
      // 81 frames / 16fps = 5.0625 秒。frameCount 規則を満たす組み合わせ。
      durationSec: 81 / 16,
      fps: 16,
      resolution: "720p",
      qualityPreset: "standard",
      motionStrength: 0.5,
    },
    templateId: `dummy-${kind}`,
  };
}

/** 全 kind に Dummy 相当の descriptor を返す供給源。 */
export function createDummyCapabilityProvider(): VideoCapabilityProvider {
  return {
    capabilityFor(kind: VideoKind): VideoCapabilityDescriptor | null {
      return dummyDescriptor(kind);
    },
  };
}
