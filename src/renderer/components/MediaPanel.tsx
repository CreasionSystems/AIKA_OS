import { useState, type FormEvent } from "react";
import { getAikaApi } from "@preload/windowApi";
import type { Job } from "@main/jobs/jobQueue";
import type { ImageJobResult } from "@shared/inference/port";

/**
 * メディアタブ (画像ジョブの境界 + ジョブ監視)。
 *
 * 投入 (submitImageJob) -> 状態取得 (getJob) -> 状態 / 生成物表示。
 * 実際の生成は当面 DummyInferenceAdapter (Fake)。動画は submitVideoJob で
 * 後続拡張する。状態更新は「状態を更新」ボタンによる明示取得 (自動ポーリングは後続)。
 */
type Phase = "idle" | "submitting" | "refreshing" | "error";

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

export function MediaPanel() {
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "submitting" || phase === "refreshing";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPhase("submitting");
    setError(null);
    setJob(null);
    try {
      const api = getAikaApi();
      const id = await api.submitImageJob({ prompt });
      setJobId(id);
      setJob((await api.getJob(id)) ?? null);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
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
