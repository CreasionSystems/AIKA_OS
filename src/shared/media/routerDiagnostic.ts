/**
 * Workflow Router の診断 (Renderer / Main 共有)。
 *
 * ADR-001 D8: VRAM 不足は入力値の不正ではなく実行環境との適合問題であるため、
 * ValidationIssue とは型の上で分離する。Router は suggested を返してよいが、
 * composer の draft を勝手に書き換えない。UI は提案として表示し、ユーザーの
 * 承認を経てから採用する。
 *
 * 本 PR では型のみを定義する。Router 実装と VRAM 見積もりは後続 PR。
 */

import type { VideoGenerationParams } from "./videoRequest";

export type RouterDiagnostic =
  | {
      kind: "missing-dependency";
      /** 不足している依存モデル / ノードの識別子。 */
      dependency: string;
      messageKey: string;
    }
  | {
      kind: "insufficient-vram";
      requested: VideoGenerationParams;
      /** 軽量化の提案。適用はユーザーの承認を必要とする。 */
      suggested: VideoGenerationParams;
      messageKey: string;
    }
  | {
      kind: "unsupported-configuration";
      messageKey: string;
    };
