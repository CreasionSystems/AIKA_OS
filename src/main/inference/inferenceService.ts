import type { JobQueue, Job } from "@main/jobs/jobQueue";
import type {
  ImageJobRequest,
  ImageJobResult,
  InferencePort,
  VideoJobRequest,
  VideoJobResult,
} from "@shared/inference/port";

/**
 * InferenceService — InferencePort と JobQueue を結線する中核サービス。
 *
 * メディアジョブ (画像 / 動画) を submit* で投入すると JobQueue にジョブ化され、
 * 背後の InferencePort (DummyInferenceAdapter など差し替え可) が実行される。
 * UI / IPC はこのサービス越しに「投入 -> 監視 -> 結果取得」を行う。
 *
 * 注意: JobQueue の jobId と、アダプタが返す MediaJobResult.jobId は別系統。
 *       前者はキュー上の識別子、後者は生成バックエンド上の識別子。
 */
export class InferenceService {
  constructor(
    private readonly port: InferencePort,
    private readonly queue: JobQueue,
  ) {}

  /** 画像生成ジョブを投入し、キューの jobId を返す。 */
  submitImageJob(req: ImageJobRequest): string {
    return this.queue.enqueue<ImageJobResult>(() => this.port.runImageJob(req));
  }

  /** 動画生成ジョブを投入し、キューの jobId を返す。 */
  submitVideoJob(req: VideoJobRequest): string {
    return this.queue.enqueue<VideoJobResult>(() => this.port.runVideoJob(req));
  }

  /** ジョブ状態を取得 (未知 id は undefined)。 */
  getJob<T = unknown>(id: string): Job<T> | undefined {
    return this.queue.getJob<T>(id);
  }

  /** ジョブが succeeded/failed に到達するまで待つ。 */
  whenSettled(id: string): Promise<void> {
    return this.queue.whenSettled(id);
  }
}
