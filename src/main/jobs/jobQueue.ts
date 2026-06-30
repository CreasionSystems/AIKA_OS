/**
 * JobQueue — 共通ジョブ管理の最小構成。
 *
 * 状態遷移: queued -> running -> succeeded | failed
 *
 * 各ジョブは独立に処理される (タスクは Promise を返す関数)。
 * 推論基盤 (InferencePort) のメディアジョブ等、非同期処理を統一的に扱う土台。
 *
 * now / idFactory を注入可能にし、タイムスタンプと ID を決定的にテストできる。
 */

export type JobState = "queued" | "running" | "succeeded" | "failed";

export interface Job<T = unknown> {
  id: string;
  state: JobState;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: T;
  error?: string;
}

/** 実行するタスク本体。 */
export type JobTask<T> = () => Promise<T>;

export interface JobQueueOptions {
  /** タイムスタンプ取得。既定は Date.now。 */
  now?: () => number;
  /** ジョブ ID 生成。既定はインスタンス内の連番。 */
  idFactory?: () => string;
}

export class JobQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly settled = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: JobQueueOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? JobQueue.defaultIdFactory();
  }

  private static defaultIdFactory(): () => string {
    let n = 0;
    return () => `job-${++n}`;
  }

  /** タスクを登録し、jobId を返す。初期状態は "queued"。 */
  enqueue<T>(task: JobTask<T>): string {
    const id = this.idFactory();
    const job: Job<T> = { id, state: "queued", createdAt: this.now() };
    this.jobs.set(id, job as Job);
    // 処理開始をマイクロタスクに遅延させ、"queued" を観測可能にする。
    this.settled.set(id, this.process(id, task));
    return id;
  }

  private async process<T>(id: string, task: JobTask<T>): Promise<void> {
    await Promise.resolve();
    const job = this.jobs.get(id) as Job<T>;
    job.state = "running";
    job.startedAt = this.now();
    try {
      job.result = await task();
      job.state = "succeeded";
    } catch (err) {
      job.state = "failed";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finishedAt = this.now();
    }
  }

  /** 現在のジョブ状態を取得。未知 id は undefined。 */
  getJob<T = unknown>(id: string): Job<T> | undefined {
    return this.jobs.get(id) as Job<T> | undefined;
  }

  /** 登録済みジョブを列挙する (登録順)。 */
  list(): Job[] {
    return [...this.jobs.values()];
  }

  /** 指定ジョブが succeeded/failed に到達するまで待つ。未知 id は即時 resolve。 */
  whenSettled(id: string): Promise<void> {
    return this.settled.get(id) ?? Promise.resolve();
  }
}
