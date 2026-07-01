import type { VideoKind } from "@shared/inference/port";

/**
 * 完了ジョブの履歴エントリ (renderer / IPC で共有)。
 * 本文 (artifacts 等) は live region 外で表示する想定の最小データ。
 */
export interface JobHistoryEntry {
  jobId: string;
  state: "succeeded" | "failed";
  /** 動画ジョブの種別。 */
  kind?: VideoKind;
  /** 生成物 (ローカル絶対パス)。 */
  artifacts?: string[];
  error?: string;
  finishedAt?: number;
}

/**
 * メモリ常駐のジョブ履歴。jobHistoryLimit に従い FIFO で最古を破棄する。
 * 永続化が必要になれば SettingsStore と同様に差し替え可能なストアへ分離する。
 */
export class JobHistory {
  private readonly entries: JobHistoryEntry[] = [];

  constructor(private readonly limit: number) {}

  /** 記録する。上限超過時は最古 (先頭) を破棄する。 */
  record(entry: JobHistoryEntry): void {
    this.entries.push(entry);
    while (this.entries.length > this.limit) {
      this.entries.shift();
    }
  }

  /** 新しい順に返す。 */
  list(): JobHistoryEntry[] {
    return [...this.entries].reverse();
  }

  get size(): number {
    return this.entries.length;
  }
}
