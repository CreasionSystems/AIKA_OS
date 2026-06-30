/**
 * UpdateManager 最小版 (確認のみ)。
 *
 * 状態機械: idle -> checking -> available / up-to-date / error
 *
 * ダウンロード・適用は本実装せず、確認の状態遷移のみを担う。
 * 実際の確認は注入された UpdateChecker (Fake / 実装) に委譲する。
 */

export interface UpdateInfo {
  version: string;
  notes?: string;
}

/** 更新確認の境界。null は「最新 (更新なし)」を表す。 */
export interface UpdateChecker {
  check(): Promise<UpdateInfo | null>;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  info?: UpdateInfo;
  error?: string;
}

/** 固定結果を返す Fake チェッカ。 */
export class FakeUpdateChecker implements UpdateChecker {
  constructor(private readonly result: UpdateInfo | null = null) {}

  check(): Promise<UpdateInfo | null> {
    return Promise.resolve(this.result);
  }
}

export class UpdateManager {
  private state: UpdateState = { phase: "idle" };

  constructor(private readonly checker: UpdateChecker) {}

  getState(): UpdateState {
    return this.state;
  }

  /**
   * 更新を確認する。確認中の二重呼び出しはガードで throw。
   * 結果に応じて available / up-to-date / error へ遷移する。
   */
  async check(): Promise<UpdateState> {
    if (this.state.phase === "checking") {
      throw new Error("既に更新確認中です");
    }
    this.state = { phase: "checking" };
    try {
      const info = await this.checker.check();
      this.state =
        info === null ? { phase: "up-to-date" } : { phase: "available", info };
    } catch (err) {
      this.state = {
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return this.state;
  }
}
