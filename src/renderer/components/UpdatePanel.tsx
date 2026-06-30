import { useState } from "react";
import { getAikaApi } from "@preload/windowApi";
import type { UpdateState } from "@main/update/updateManager";

/**
 * 更新画面。確認ボタン -> checkUpdate -> 状態表示。
 *
 * checking は UI の保留状態として表現し、最終遷移 (up-to-date / available /
 * error) は checkUpdate の戻り値で表示する。
 */
type UiPhase = "idle" | "checking" | "done";

function describe(state: UpdateState): string {
  switch (state.phase) {
    case "up-to-date":
      return "最新です";
    case "available":
      return `新しいバージョン (${state.info?.version ?? "?"}) があります`;
    case "error":
      return `確認に失敗しました: ${state.error ?? "unknown"}`;
    default:
      return "未確認";
  }
}

export function UpdatePanel() {
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [state, setState] = useState<UpdateState | null>(null);

  async function onCheck() {
    setPhase("checking");
    setState(null);
    try {
      const result = await getAikaApi().checkUpdate();
      setState(result);
    } catch (err) {
      setState({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPhase("done");
    }
  }

  const isError = state?.phase === "error";

  return (
    <section>
      <h1>更新</h1>
      <button
        type="submit"
        onClick={onCheck}
        disabled={phase === "checking"}
      >
        更新を確認
      </button>

      {phase === "checking" && <p>確認中…</p>}
      {phase === "idle" && <p>未確認</p>}
      {phase === "done" && state !== null && !isError && (
        <p>{describe(state)}</p>
      )}
      {isError && <p role="alert">{describe(state)}</p>}
    </section>
  );
}
