import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getAikaApi } from "@preload/windowApi";
import type { UpdateState } from "@main/update/updateManager";

/**
 * 更新画面。確認ボタン -> checkUpdate -> 状態表示。ラベルは i18n。
 *
 * checking は UI の保留状態として表現し、最終遷移 (up-to-date / available /
 * error) は checkUpdate の戻り値で表示する。
 */
type UiPhase = "idle" | "checking" | "done";

function describe(t: TFunction, state: UpdateState): string {
  switch (state.phase) {
    case "up-to-date":
      return t("update.status.upToDate");
    case "available":
      return t("update.status.available", {
        version: state.info?.version ?? "?",
      });
    case "error":
      return t("update.status.error", { error: state.error ?? "unknown" });
    default:
      return t("update.status.idle");
  }
}

/** live region に出す短い状態 (エラーは含めない)。 */
function statusText(
  t: TFunction,
  phase: UiPhase,
  state: UpdateState | null,
): string {
  if (phase === "checking") return t("update.status.checking");
  if (phase === "idle" || state === null) return t("update.status.idle");
  if (state.phase === "error") return "";
  return describe(t, state);
}

export function UpdatePanel() {
  const { t } = useTranslation();
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

  const isError = phase === "done" && state?.phase === "error";

  return (
    <section>
      <h1>{t("update.title")}</h1>
      <button
        type="submit"
        onClick={onCheck}
        disabled={phase === "checking"}
      >
        {t("update.action.check")}
      </button>

      {/* live region は最初から DOM に常設する。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {statusText(t, phase, state)}
      </p>

      {isError && state !== null && <p role="alert">{describe(t, state)}</p>}
    </section>
  );
}
