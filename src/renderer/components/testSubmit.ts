import { vi } from "vitest";
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
      completion: Promise.resolve(),
    }),
  );
}

/**
 * ジョブ完了で失敗する onSubmit。
 *
 * completion は呼び出し時に生成する。mock 設定時に作ると、await されるまで
 * 未処理のまま残り unhandled rejection として検出される。
 */
export function failingSubmit(message: string, jobId = "job-1") {
  return vi.fn(
    async (): Promise<ComposerSubmitOutcome> => ({
      status: "accepted",
      jobId,
      completion: (async () => {
        throw new Error(message);
      })(),
    }),
  );
}
