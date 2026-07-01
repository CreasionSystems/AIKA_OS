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
 * 履歴永続化の差し替え境界 (SettingsStore と同方針、async 統一)。
 * 保存は時系列 (古い順) の配列。
 */
export interface JobHistoryStore {
  load(): Promise<JobHistoryEntry[]>;
  save(entries: JobHistoryEntry[]): Promise<void>;
}

/** メモリ上の JobHistoryStore 実装 (テスト / 既定)。 */
export class MemoryJobHistoryStore implements JobHistoryStore {
  private data: JobHistoryEntry[];
  constructor(initial: JobHistoryEntry[] = []) {
    this.data = [...initial];
  }
  load(): Promise<JobHistoryEntry[]> {
    return Promise.resolve([...this.data]);
  }
  save(entries: JobHistoryEntry[]): Promise<void> {
    this.data = [...entries];
    return Promise.resolve();
  }
}

/**
 * ジョブ履歴。jobHistoryLimit に従い FIFO で最古を破棄する。
 * 任意で JobHistoryStore を注入し、init で読込・record で永続化する
 * (Memory/File を差し替え可能)。list はキャッシュから同期で返す。
 */
export class JobHistory {
  private entries: JobHistoryEntry[] = [];
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly store?: JobHistoryStore,
  ) {}

  /** 永続値を上限内 (最新側) に読み込む。 */
  async init(): Promise<void> {
    if (!this.store) return;
    const loaded = await this.store.load();
    this.entries = loaded.slice(-this.limit);
  }

  /** 記録する。上限超過時は最古 (先頭) を破棄し、ストアへ永続化する。 */
  record(entry: JobHistoryEntry): void {
    this.entries.push(entry);
    while (this.entries.length > this.limit) {
      this.entries.shift();
    }
    if (this.store) {
      const snapshot = [...this.entries];
      this.pending = this.pending.then(() => this.store!.save(snapshot));
    }
  }

  /** 保留中の永続化が完了するまで待つ (テスト用)。 */
  whenIdle(): Promise<void> {
    return this.pending;
  }

  /** 新しい順に返す。 */
  list(): JobHistoryEntry[] {
    return [...this.entries].reverse();
  }

  get size(): number {
    return this.entries.length;
  }
}
