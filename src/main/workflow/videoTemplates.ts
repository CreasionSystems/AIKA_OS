import type { VideoKind } from "@shared/inference/port";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";
import {
  DEFAULT_ASSET_REQUIREMENTS,
  DEFAULT_PROMPT_REQUIREMENT,
} from "@shared/media/videoCapability";

/**
 * 動画テンプレート定義の単一情報源。
 *
 * `VideoCapabilityProvider` (UI・検証向けの「何を選べるか」) と
 * `WorkflowRouter` (実行向けの「何を注入するか」) の両方がここを読む。
 * 両者のインターフェースは統合せず、定義だけを共有する (ADR-001 D2)。
 *
 * 現時点は Dummy バックエンド相当の1種のみ。実測値に基づく descriptor
 * (Wan / LTX / SVD) と、ノード id への写像は ComfyUI 接続時に別 PR で追加する。
 */

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

/**
 * kind に対応するテンプレートの定義。対応が無ければ null。
 * 「対応テンプレートが無い」は入力の不正ではないため、例外にしない。
 */
export function descriptorFor(
  kind: VideoKind,
): VideoCapabilityDescriptor | null {
  return dummyDescriptor(kind);
}
