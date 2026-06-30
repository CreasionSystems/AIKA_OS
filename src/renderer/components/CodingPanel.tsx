import { useState, type FormEvent } from "react";
import { getAikaApi } from "@preload/windowApi";
import type { CodingView } from "@main/coding/codingWorkflow";

/**
 * コーディング支援画面 (plan 縦切り)。
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
  phase: Phase,
  state: CodingView | null,
  lastAction: LastAction,
): string {
  switch (phase) {
    case "planning":
      return "計画を作成中…";
    case "executing":
      return "実行中…";
    case "verifying":
      return "検証中…";
    case "rewinding":
      return "1手戻し中…";
    default:
      break;
  }
  if (state === null) return "未着手";
  switch (lastAction) {
    case "plan":
      return `計画を作成しました（${state.plan?.steps.length ?? 0}手順）`;
    case "execute":
      return "実行が完了しました";
    case "verify":
      return "検証が完了しました";
    case "rewind":
      return `1手戻しました（${state.phase}）`;
    default:
      return "未着手";
  }
}

export function CodingPanel() {
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
      <h1>コーディング</h1>

      {/* 短い状態サマリーのみ live region に置く (本文・ログ全文は含めない)。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {summarize(phase, state, lastAction)}
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="coding-goal">目標 (goal)</label>
        <textarea
          id="coding-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {phase === "planning" ? "作成中…" : "計画を作成"}
        </button>
      </form>

      <button type="button" onClick={onRewind} disabled={!canRewind}>
        {phase === "rewinding" ? "戻し中…" : "1手戻す"}
      </button>

      {error !== null && <p role="alert">{error}</p>}

      {state?.plan && (
        <div aria-label="計画">
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
        {phase === "executing" ? "実行中…" : "実行"}
      </button>

      {state?.executionLog && (
        <div aria-label="実行ログ">
          <ul>
            {state.executionLog.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={onVerify} disabled={!canVerify}>
        {phase === "verifying" ? "検証中…" : "検証"}
      </button>

      {state?.verification && (
        <div aria-label="検証結果">
          <p>{state.verification.passed ? "passed" : "failed"}</p>
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
