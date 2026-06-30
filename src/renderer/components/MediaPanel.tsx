import { useEffect, useRef, useState, type FormEvent } from "react";
import { getAikaApi } from "@preload/windowApi";
import type { Job } from "@main/jobs/jobQueue";
import type { ImageJobResult } from "@shared/inference/port";

/**
 * メディアタブ (画像ジョブの境界 + ジョブ監視)。
 *
 * 投入 (submitImageJob) -> 自動ポーリング (getJob) -> 状態 / 生成物表示。
 * succeeded / failed に達するか上限に達したら停止する。「状態を更新」での
 * 手動再取得も残す。実際の生成は当面 DummyInferenceAdapter (Fake)。
 *
 * sleep / pollInterval / maxPolls は注入可能 (テストは待たずに決定的)。
 */
type Phase = "idle" | "submitting" | "polling" | "refreshing" | "error";

const DEFAULT_POLL_INTERVAL = 500;
const DEFAULT_MAX_POLLS = 60;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSettled(job: Job | null): boolean {
  return job?.state === "succeeded" || job?.state === "failed";
}

function summarize(phase: Phase, job: Job | null): string {
  if (phase === "submitting") return "ジョブを投入中…";
  if (phase === "refreshing") return "状態を更新中…";
  if (job === null) return "未投入";
  switch (job.state) {
    case "queued":
      return "待機中";
    case "running":
      return "実行中";
    case "succeeded":
      return "完了しました";
    case "failed":
      return "失敗しました";
  }
}

export interface MediaPanelProps {
  sleep?: (ms: number) => Promise<void>;
  pollInterval?: number;
  maxPolls?: number;
}

export function MediaPanel({
  sleep = defaultSleep,
  pollInterval = DEFAULT_POLL_INTERVAL,
  maxPolls = DEFAULT_MAX_POLLS,
}: MediaPanelProps = {}) {
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy =
    phase === "submitting" || phase === "polling" || phase === "refreshing";

  /** succeeded/failed か上限まで getJob を反復する。 */
  async function poll(id: string) {
    for (let i = 0; i < maxPolls; i += 1) {
      const next = (await getAikaApi().getJob(id)) ?? null;
      if (!mounted.current) return;
      setJob(next);
      if (isSettled(next)) return;
      await sleep(pollInterval);
      if (!mounted.current) return;
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPhase("submitting");
    setError(null);
    setJob(null);
    try {
      const id = await getAikaApi().submitImageJob({ prompt });
      if (!mounted.current) return;
      setJobId(id);
      setPhase("polling");
      await poll(id);
      if (mounted.current) setPhase("idle");
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    }
  }

  async function onRefresh() {
    if (jobId === null) return;
    setPhase("refreshing");
    setError(null);
    try {
      setJob((await getAikaApi().getJob(jobId)) ?? null);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  const artifacts =
    job?.state === "succeeded"
      ? (job.result as ImageJobResult | undefined)?.artifacts
      : undefined;

  return (
    <section>
      <h1>メディア</h1>

      {/* 短い状態サマリーのみ live region に置く。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {summarize(phase, job)}
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="media-prompt">プロンプト</label>
        <textarea
          id="media-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {phase === "submitting" ? "投入中…" : "画像ジョブを投入"}
        </button>
      </form>

      <button
        type="button"
        onClick={onRefresh}
        disabled={jobId === null || busy}
      >
        状態を更新
      </button>

      {error !== null && <p role="alert">{error}</p>}

      {jobId !== null && <p>ジョブID: {jobId}</p>}

      {artifacts && (
        <ul aria-label="生成物">
          {artifacts.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
