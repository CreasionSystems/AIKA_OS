import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getAikaApi } from "@preload/windowApi";
import type { Job } from "@main/jobs/jobQueue";
import type {
  ImageJobResult,
  VideoJobResult,
  VideoKind,
} from "@shared/inference/port";
import type { JobHistoryEntry } from "@shared/jobs/jobHistory";

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

/** 種別: 画像 + 動画 5 種。 */
type MediaKind = "image" | VideoKind;

/** ラベルは i18n。option キーは media.kind.option.<value>。 */
const KIND_VALUES: MediaKind[] = [
  "image",
  "t2v",
  "i2v",
  "continuation",
  "edit",
  "audio",
];

/** 元画像 (sourceImage) が必須の動画種別。 */
const SOURCE_REQUIRED_KINDS: ReadonlySet<MediaKind> = new Set<MediaKind>([
  "i2v",
  "continuation",
  "edit",
]);

const DEFAULT_POLL_INTERVAL = 500;
const DEFAULT_MAX_POLLS = 60;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSettled(job: Job | null): boolean {
  return job?.state === "succeeded" || job?.state === "failed";
}

function summarize(t: TFunction, phase: Phase, job: Job | null): string {
  if (phase === "submitting") return t("media.status.submitting");
  if (phase === "refreshing") return t("media.status.refreshing");
  if (job === null) return t("media.status.idle");
  switch (job.state) {
    case "queued":
      return t("media.status.queued");
    case "running":
      return t("media.status.running");
    case "succeeded":
      return t("media.status.succeeded");
    case "failed":
      return t("media.status.failed");
  }
}

export interface MediaPanelProps {
  sleep?: (ms: number) => Promise<void>;
  pollInterval?: number;
  maxPolls?: number;
}

export function MediaPanel({
  sleep = defaultSleep,
  pollInterval,
  maxPolls = DEFAULT_MAX_POLLS,
}: MediaPanelProps = {}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<MediaKind>("image");
  const [sourceImage, setSourceImage] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sourceInvalid, setSourceInvalid] = useState(false);
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);

  const sourceRequired = SOURCE_REQUIRED_KINDS.has(kind);

  // ポーリング周期: prop 明示指定を最優先、未指定なら設定値、なければ既定。
  const [pollMs, setPollMs] = useState(pollInterval ?? DEFAULT_POLL_INTERVAL);

  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (pollInterval !== undefined) return;
    void getAikaApi()
      .getSettings()
      .then((s) => {
        if (mounted.current && s) setPollMs(s.mediaPollIntervalMs);
      });
  }, [pollInterval]);

  /** 履歴を取得して表示を更新する (本文は live region 外)。 */
  async function refreshHistory() {
    const entries = await getAikaApi().listJobs();
    if (mounted.current && Array.isArray(entries)) setHistory(entries);
  }

  async function onClearHistory() {
    setError(null);
    try {
      await getAikaApi().clearJobs();
      if (mounted.current) setHistory([]);
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    }
  }

  useEffect(() => {
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await sleep(pollMs);
      if (!mounted.current) return;
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSourceInvalid(false);

    // source 必須種別の検証 (投入前に阻止し、入力へ関連付ける)。
    if (sourceRequired && sourceImage.trim() === "") {
      setSourceInvalid(true);
      setError(t("media.error.sourceRequired"));
      return;
    }

    setPhase("submitting");
    setJob(null);
    try {
      const api = getAikaApi();
      let id: string;
      if (kind === "image") {
        id = await api.submitImageJob({ prompt });
      } else {
        id = await api.submitVideoJob(
          sourceRequired ? { kind, prompt, sourceImage } : { kind, prompt },
        );
      }
      if (!mounted.current) return;
      setJobId(id);
      setPhase("polling");
      await poll(id);
      if (mounted.current) setPhase("idle");
      await refreshHistory();
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

  const result =
    job?.state === "succeeded"
      ? (job.result as ImageJobResult | VideoJobResult | undefined)
      : undefined;
  const artifacts = result?.artifacts;
  const resultKind: VideoKind | undefined =
    result !== undefined && "kind" in result
      ? (result as VideoJobResult).kind
      : undefined;

  const submitLabel =
    kind === "image"
      ? t("media.action.submitImage")
      : t("media.action.submitVideo");

  return (
    <section>
      <h1>{t("media.title")}</h1>

      {/* 短い状態サマリーのみ live region に置く。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {summarize(t, phase, job)}
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="media-kind">{t("media.kind.label")}</label>
        <select
          id="media-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as MediaKind)}
        >
          {KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {t(`media.kind.option.${k}`)}
            </option>
          ))}
        </select>

        <label htmlFor="media-prompt">{t("media.prompt.label")}</label>
        <textarea
          id="media-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        {sourceRequired && (
          <>
            <label htmlFor="media-source">{t("media.source.label")}</label>
            <input
              id="media-source"
              type="text"
              value={sourceImage}
              onChange={(e) => setSourceImage(e.target.value)}
              aria-invalid={sourceInvalid}
              aria-describedby={sourceInvalid ? "media-error" : undefined}
            />
          </>
        )}

        <button type="submit" disabled={busy}>
          {phase === "submitting" ? t("media.action.submitting") : submitLabel}
        </button>
      </form>

      <button
        type="button"
        onClick={onRefresh}
        disabled={jobId === null || busy}
      >
        {t("media.action.refresh")}
      </button>

      {error !== null && (
        <p role="alert" id="media-error">
          {error}
        </p>
      )}

      {jobId !== null && <p>{t("media.jobId", { id: jobId })}</p>}

      {resultKind !== undefined && (
        <p>{t("media.result.kind", { kind: resultKind })}</p>
      )}

      {artifacts && (
        <ul aria-label={t("media.artifacts.label")}>
          {artifacts.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <div>
          <h2>{t("media.history.title")}</h2>
          <button type="button" onClick={onClearHistory}>
            {t("media.history.clear")}
          </button>
          <ul aria-label={t("media.history.title")}>
            {history.map((e, i) => (
              <li key={i}>
                {e.jobId} — {e.state}
                {e.kind ? ` (${e.kind})` : ""}
                {e.artifacts && e.artifacts.length > 0
                  ? ` — ${e.artifacts.join(", ")}`
                  : ""}
                {e.error ? ` — ${e.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
