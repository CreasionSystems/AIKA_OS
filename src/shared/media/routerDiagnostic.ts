/**
 * 実行環境の診断 (Renderer / Main 共有)。
 *
 * ADR-001 D8: VRAM 不足は入力値の不正ではなく実行環境との適合問題であるため、
 * ValidationIssue とは型の上で分離する。診断は suggested を返してよいが、
 * composer の draft を勝手に書き換えない。UI は提案として表示し、ユーザーの
 * 承認を経てから採用する。
 *
 * `invalid` との線引き (PR-G で確定):
 * - `invalid`                   … 要求そのものが descriptor の値域・構造に反する
 * - `unsupported-configuration` … 正規化済みだが、選ばれた workflow / backend /
 *                                 環境の組み合わせでは実行できない
 * - `missing-dependency`        … 実行に必要なモデル・ノード・ファイルが無い
 * - `insufficient-vram`         … 値は有効だが現在の VRAM では実行できない
 */

import type { VideoGenerationParams } from "./videoRequest";

export type RouterDiagnostic =
  | {
      kind: "missing-dependency";
      /**
       * 不足している依存モデル / ノードの安定した技術識別子。
       * 本文の唯一の説明にはせず、詳細として補助的に見せる。
       */
      dependency: string;
      /**
       * 既知の依存にだけ付く、ユーザー向け表示名の i18n キー。
       * 表示名の対応は診断を作る側 (main) が持ち、UI に条件分岐を埋めない。
       */
      dependencyLabelKey?: string;
      messageKey: "media.diagnostic.missingDependency";
    }
  | {
      kind: "insufficient-vram";
      requested: VideoGenerationParams;
      /** 軽量化の提案。適用はユーザーの承認を必要とする。 */
      suggested: VideoGenerationParams;
      messageKey: "media.diagnostic.insufficientVram";
    }
  | {
      kind: "unsupported-configuration";
      messageKey: "media.diagnostic.unsupportedConfiguration";
    };
