import { useState, type FormEvent } from "react";
import { getAikaApi } from "@preload/windowApi";
import type { CodingState } from "@main/coding/codingWorkflow";

/**
 * コーディング支援画面 (plan 縦切り)。
 * 目標 (goal) 入力 -> 計画作成 (planCode) -> 計画表示。
 * Execute / Verify / Rewind は後続の縦切りで追加する。
 */
type Phase = "idle" | "planning" | "executing" | "error";

export function CodingPanel() {
  const [goal, setGoal] = useState("");
  const [state, setState] = useState<CodingState | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "planning" || phase === "executing";
  const canExecute = state?.phase === "planned" && !busy;

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
    </section>
  );
}
