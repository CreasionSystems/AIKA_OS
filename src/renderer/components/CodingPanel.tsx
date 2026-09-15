import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getAikaApi } from "@preload/windowApi";
import type { CodingView } from "@main/coding/codingWorkflow";

/**
 * コーディング支援画面 (plan 縦切り)。ラベルは i18n。
 * 目標 (goal) 入力 -> 計画作成 (planCode) -> 計画表示。
 * Execute / Verify / Rewind は後続の縦切りで追加する。
 */
type Phase =
  | "idle"
  | "planning"
  | "executing"
  | "verifying"
  | "rewinding"
  | "error";

/** 直近に完了した操作。状態サマリーの文言切替に使う。 */
type LastAction = "plan" | "execute" | "verify" | "rewind" | null;

/** live region 用の短い状態サマリー (本文・ログ全文は含めない)。 */
function summarize(
  t: TFunction,
  phase: Phase,
  state: CodingView | null,
  lastAction: LastAction,
): string {
  switch (phase) {
    case "planning":
      return t("coding.status.planning");
    case "executing":
      return t("coding.status.executing");
    case "verifying":
      return t("coding.status.verifying");
    case "rewinding":
      return t("coding.status.rewinding");
    default:
      break;
  }
  if (state === null) return t("coding.status.idle");
  switch (lastAction) {
    case "plan":
      // 件数は plural 機構で扱う (文字列連結しない)。
      return t("coding.status.planned", {
        count: state.plan?.steps.length ?? 0,
      });
    case "execute":
      return t("coding.status.executed");
    case "verify":
      return t("coding.status.verified");
    case "rewind":
      return t("coding.status.rewound", { phase: state.phase });
    default:
      return t("coding.status.idle");
  }
}

export function CodingPanel() {
  const { t } = useTranslation();
  const [goal, setGoal] = useState("");
  const [state, setState] = useState<CodingView | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<LastAction>(null);

  const busy =
    phase === "planning" ||
    phase === "executing" ||
    phase === "verifying" ||
    phase === "rewinding";
  const canExecute = state?.phase === "planned" && !busy;
  const canVerify = state?.phase === "executed" && !busy;
  const canRewind = (state?.canRewind ?? false) && !busy;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPhase("planning");
    setError(null);
    try {
      const next = await getAikaApi().planCode(goal);
      setState(next);
      setLastAction("plan");
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function onExecute() {
    setPhase("executing");
    setError(null);
    try {
      const next = await getAikaApi().executeCode();
      setState(next);
      setLastAction("execute");
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function onVerify() {
    setPhase("verifying");
    setError(null);
    try {
      const next = await getAikaApi().verifyCode();
      setState(next);
      setLastAction("verify");
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function onRewind() {
    setPhase("rewinding");
    setError(null);
    try {
      const next = await getAikaApi().rewindCode();
      setState(next);
      setLastAction("rewind");
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <section>
      <h1>{t("coding.title")}</h1>

      {/* 短い状態サマリーのみ live region に置く (本文・ログ全文は含めない)。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {summarize(t, phase, state, lastAction)}
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="coding-goal">{t("coding.goal.label")}</label>
        <textarea
          id="coding-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {phase === "planning"
            ? t("coding.action.planning")
            : t("coding.action.plan")}
        </button>
      </form>

      <button type="button" onClick={onRewind} disabled={!canRewind}>
        {phase === "rewinding"
          ? t("coding.action.rewinding")
          : t("coding.action.rewind")}
      </button>

      {error !== null && <p role="alert">{error}</p>}

      {state?.plan && (
        <div aria-label={t("coding.plan.label")}>
          <p>{state.plan.summary}</p>
          <ol>
            {state.plan.steps.map((s, i) => (
              <li key={i}>
                <strong>{s.title}</strong>: {s.detail}
              </li>
            ))}
          </ol>
        </div>
      )}

      <button type="button" onClick={onExecute} disabled={!canExecute}>
        {phase === "executing"
          ? t("coding.action.executing")
          : t("coding.action.execute")}
      </button>

      {state?.executionLog && (
        <div aria-label={t("coding.executionLog.label")}>
          <ul>
            {state.executionLog.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={onVerify} disabled={!canVerify}>
        {phase === "verifying"
          ? t("coding.action.verifying")
          : t("coding.action.verify")}
      </button>

      {state?.verification && (
        <div aria-label={t("coding.verification.label")}>
          <p>
            {state.verification.passed
              ? t("coding.verification.passed")
              : t("coding.verification.failed")}
          </p>
          <ul>
            {state.verification.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
