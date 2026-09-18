import type { RoutedWorkflow } from "@shared/inference/port";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";
import { descriptorFor } from "./videoTemplates";

/**
 * Workflow Router — 正規化済み要求をテンプレートへ注入する (実行向け)。
 *
 * ADR-001 D2 / D8:
 * - UI にテンプレート知識を漏らさない (templateId の中身は renderer に渡さない)
 * - **値を補完・変換・書き換えしない。** ユーザーが画面で確認した値を、
 *   そのまま inputs へ移すだけ
 * - 検証は行わない。検証済みの要求だけを受け取る
 *
 * VideoCapabilityProvider とは責務が異なるため別インターフェースとし、
 * 定義だけを videoTemplates.ts で共有する。
 */
export interface WorkflowRouter {
  /** 対応テンプレートが無ければ null (エラーではない)。 */
  route(req: NormalizedVideoJobRequest): RoutedWorkflow | null;
}

/**
 * Dummy テンプレート用の Router。
 *
 * inputs のキーはテンプレートごとに異なるため共有型では固定しない。
 * ここで注入する正準キーは Router のテストで固定する。実テンプレート接続時は
 * この正準形からノード id へ写す層が入る。
 */
export function createDummyWorkflowRouter(): WorkflowRouter {
  return {
    route(req: NormalizedVideoJobRequest): RoutedWorkflow | null {
      const descriptor = descriptorFor(req.kind);
      if (descriptor === null) return null;
      // 出力は凍結する。inputs の Readonly は型だけの約束で、実行時には
      // 下流 (Preflight など) が書き換えられてしまうため (PR-G)。
      return Object.freeze({
        templateId: descriptor.templateId,
        inputs: Object.freeze({
          prompt: req.prompt,
          durationSec: req.params.durationSec,
          fps: req.params.fps,
          resolution: req.params.resolution,
          qualityPreset: req.params.qualityPreset,
          motionStrength: req.params.motionStrength,
          // image 以外 (video / audio) も落とさずすべて渡す。
          assets: req.assets,
        }),
      });
    },
  };
}
