import type { VideoKind } from "@shared/inference/port";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";
import { descriptorFor } from "./videoTemplates";

/**
 * 動画テンプレートの能力記述を供給する (main 側)。
 *
 * ADR-001 D2: テンプレート知識は Router 側に閉じる。renderer へ渡すのは
 * 「何が選べるか」を表す VideoCapabilityDescriptor だけで、templateId の
 * 中身や JSON 構造は渡さない。
 *
 * 定義の実体は videoTemplates.ts。WorkflowRouter と同じ定義を読むが、
 * 責務が異なるためインターフェースは統合しない。
 */
export interface VideoCapabilityProvider {
  /** kind に対応する能力記述。対応テンプレートが無ければ null (エラーではない)。 */
  capabilityFor(kind: VideoKind): VideoCapabilityDescriptor | null;
}

/** テンプレート定義から能力記述を返す供給源。 */
export function createDummyCapabilityProvider(): VideoCapabilityProvider {
  return {
    capabilityFor(kind: VideoKind): VideoCapabilityDescriptor | null {
      return descriptorFor(kind);
    },
  };
}
