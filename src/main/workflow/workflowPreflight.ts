import type { RoutedWorkflow } from "@shared/inference/port";
import type { RouterDiagnostic } from "@shared/media/routerDiagnostic";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";

/**
 * 実行前の環境診断 (PR-G)。
 *
 * ADR-001 D2 と同じ理由で WorkflowRouter とは別インターフェースにする。
 * Router は「どのテンプレートに何を注入するか」を決める純粋関数であり、
 * 依存モデルの有無や VRAM の照会は副作用を伴う環境問い合わせだからである。
 * Router に混ぜると決定性が壊れ、既存の純粋性テストが成り立たなくなる。
 *
 * 呼び出し位置は route() の後・enqueue の前。1件でも診断が出たら投入しない。
 *
 * 受け取ってよいのは「正規化済みの要求」と「Router が選んだ workflow」だけ。
 * 会話ログ・renderer の内部状態・IPC チャンネル名は渡さない。
 * draft も inputs も書き換えない (ADR-001 D8)。
 */
export interface WorkflowPreflightPort {
  diagnose(
    req: NormalizedVideoJobRequest,
    workflow: RoutedWorkflow,
  ): Promise<readonly RouterDiagnostic[]>;
}

/**
 * 本番の既定実装。常に診断なし。
 *
 * 実測に基づかない VRAM 閾値を Dummy に入れると、架空の実行制約が仕様に
 * なってしまう。実際の依存判定と VRAM 見積もりは ComfyUI 実接続の PR で
 * 追加する。診断の分岐はテストで差し替えた実装によって網羅する。
 *
 * 「既定値が診断なし」と「診断の経路が存在しない」は別物であり、
 * 経路そのものはここで本番コードに繋いでおく。
 */
export function createNoopWorkflowPreflight(): WorkflowPreflightPort {
  return {
    async diagnose(): Promise<readonly RouterDiagnostic[]> {
      return [];
    },
  };
}
