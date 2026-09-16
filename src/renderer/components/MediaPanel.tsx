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
import type { PromptRefinementPort } from "@shared/media/promptRefinement";
import {
  VideoPromptComposer,
  type ComposerSubmitOutcome,
} from "./VideoPromptComposer";
import type { NormalizedVideoJobRequest } from "@shared/media/videoRequest";

/**
 * メディアタブ (画像/動画ジョブの境界 + ジョブ監視)。
 *
 * 画像: プロンプト入力 -> submitImageJob -> 自動ポーリング。
 * 動画: 自由指示ベースの対話型コンポーザ (VideoPromptComposer) で最終プロンプトを
 *       確定 -> submitVideoJob -> 自動ポーリング。実際の生成は当面 Dummy (Fake)。
 *
 * sleep / pollInterval / maxPolls は注入可能 (テストは待たずに決定的)。
 * refine は動画コンポーザの補完ポート (テスト差し替え用)。
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

/** 画像パスの短い状態サマリー (動画はコンポーザが自前で持つ)。 */
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
  refine?: PromptRefinementPort;
}

export function MediaPanel({
  sleep = defaultSleep,
  pollInterval,
  maxPolls = DEFAULT_MAX_POLLS,
  refine,
}: MediaPanelProps = {}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<MediaKind>("image");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);

  const sourceRequired = SOURCE_REQUIRED_KINDS.has(kind);
  const isVideo = kind !== "image";

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

  /** succeeded/failed か上限まで getJob を反復し、最終ジョブを返す。 */
  async function poll(id: string): Promise<Job | null> {
    let last: Job | null = null;
    for (let i = 0; i < maxPolls; i += 1) {
      const next = (await getAikaApi().getJob(id)) ?? null;
      if (!mounted.current) return last;
      setJob(next);
      last = next;
      if (isSettled(next)) return next;
      await sleep(pollMs);
      if (!mounted.current) return last;
    }
    return last;
  }

  /** 画像ジョブ: プロンプト -> submitImageJob -> ポーリング。 */
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPhase("submitting");
    setJob(null);
    try {
      const id = await getAikaApi().submitImageJob({ prompt });
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

  /**
   * 動画ジョブ投入 (コンポーザからの送信ハンドラ)。
   * 成功で解決、失敗 (投入失敗 or ジョブ失敗) で reject し、コンポーザ側で
   * error 状態 / retry を扱えるようにする。
   */
  async function runVideoJob(
    req: NormalizedVideoJobRequest,
  ): Promise<ComposerSubmitOutcome> {
    setPhase("submitting");
    setJob(null);
    const result = await getAikaApi().submitVideoJob(req);
    if (result.status === "invalid") {
      // 検証失敗は例外ではなく明細として返し、コンポーザが field error を出す。
      if (mounted.current) setPhase("idle");
      return { status: "invalid", issues: result.issues };
    }
    const id = result.jobId;
    if (!mounted.current) return { status: "accepted", jobId: id, completion: Promise.resolve() };
    setJobId(id);
    setPhase("polling");
    // 受理後のジョブ完了は別の Promise として返し、コンポーザが sending を出せるようにする。
    const completion = (async () => {
      const final = await poll(id);
      if (mounted.current) setPhase("idle");
      await refreshHistory();
      if (final?.state === "failed") {
        throw new Error(final.error ?? "failed");
      }
    })();
    return { status: "accepted", jobId: id, completion };
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

  return (
    <section>
      <h1>{t("media.title")}</h1>

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

      {isVideo ? (
        <VideoPromptComposer
          kind={kind as VideoKind}
          sourceRequired={sourceRequired}
          onSubmit={runVideoJob}
          {...(refine ? { refine } : {})}
        />
      ) : (
        <>
          {/* 短い状態サマリーのみ live region に置く。 */}
          <p role="status" aria-live="polite" aria-atomic="true">
            {summarize(t, phase, job)}
          </p>

          <form onSubmit={onSubmit}>
            <label htmlFor="media-prompt">{t("media.prompt.label")}</label>
            <textarea
              id="media-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {phase === "submitting"
                ? t("media.action.submitting")
                : t("media.action.submitImage")}
            </button>
          </form>

          {error !== null && (
            <p role="alert" id="media-error">
              {error}
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onRefresh}
        disabled={jobId === null || busy}
      >
        {t("media.action.refresh")}
      </button>

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
