import { vi } from "vitest";
import type { RouterDiagnostic } from "@shared/media/routerDiagnostic";
import type { ComposerSubmitOutcome } from "./VideoPromptComposer";

/**
 * テスト用の onSubmit。受理され、ジョブも成功する既定形。
 *
 * 実装は MediaPanel が担うため、コンポーザのテストでは結果ユニオンだけを返す。
 */
export function acceptingSubmit(jobId = "job-1") {
  return vi.fn(
    async (): Promise<ComposerSubmitOutcome> => ({
      status: "accepted",
      jobId,
      completion: Promise.resolve({ status: "succeeded" }),
    }),
  );
}

/**
 * ジョブ完了で失敗する onSubmit。
 *
 * completion は reject しない契約 (PR-G)。失敗も解決値で返すため、mock 設定時に
 * 生成しても未処理の拒否にならない。本文は i18n キーで渡す。
 */
export function failingSubmit(messageKey: string, jobId = "job-1") {
  return vi.fn(
    async (): Promise<ComposerSubmitOutcome> => ({
      status: "accepted",
      jobId,
      completion: Promise.resolve({ status: "failed", messageKey }),
    }),
  );
}

/** 実行環境の診断で投入が止まる onSubmit。 */
export function blockedSubmit(diagnostics: readonly RouterDiagnostic[]) {
  return vi.fn(
    async (): Promise<ComposerSubmitOutcome> => ({
      status: "blocked",
      diagnostics,
    }),
  );
}
