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

export function CodingPanel() {
  const [goal, setGoal] = useState("");
  const [state, setState] = useState<CodingView | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

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
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <section>
      <h1>コーディング</h1>
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
