import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getAikaApi } from "@preload/windowApi";
import {
  WRITING_MODES,
  WritingValidationError,
} from "@shared/writing/writingModes";
import type { WritingMode } from "@shared/inference/port";

/** エラーを利用者向けメッセージへ変換する。検証エラーは違反明細を出す。 */
function toErrorMessage(err: unknown): string {
  if (err instanceof WritingValidationError) {
    return err.violations.map((v) => v.message).join(" / ");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * 文章作成の最小画面。ラベルは i18n。
 * 入力 (プロンプト + モード) -> window.aika.generateText -> 結果表示。
 */
type Status = "idle" | "running" | "error";

const MODE_OPTIONS = Object.values(WRITING_MODES);

/** live region 用の短い状態サマリー (生成本文は含めない)。 */
function summarize(t: TFunction, status: Status, hasResult: boolean): string {
  if (status === "running") return t("writing.status.generating");
  return hasResult ? t("writing.status.generated") : t("writing.status.idle");
}

export function WritingPanel() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<WritingMode>("general");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const running = status === "running";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("running");
    setError(null);
    setResult(null);
    try {
      const res = await getAikaApi().generateText({ mode, prompt });
      setResult(res.text);
      setStatus("idle");
    } catch (err) {
      setError(toErrorMessage(err));
      setStatus("error");
    }
  }

  return (
    <section>
      <h1>{t("writing.title")}</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="writing-mode">{t("writing.mode.label")}</label>
        <select
          id="writing-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as WritingMode)}
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m.mode} value={m.mode}>
              {t(`writing.mode.option.${m.mode}`)}
            </option>
          ))}
        </select>

        <label htmlFor="writing-prompt">{t("writing.prompt.label")}</label>
        <textarea
          id="writing-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <button type="submit" disabled={running}>
          {running ? t("writing.action.generating") : t("writing.action.generate")}
        </button>
      </form>

      {/* 短い状態サマリーのみ live region に置く (生成本文は含めない)。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {summarize(t, status, result !== null)}
      </p>

      {error !== null && <p role="alert">{error}</p>}

      {result !== null && (
        <div className="generated-output" aria-label={t("writing.result.label")}>
          {result}
        </div>
      )}
    </section>
  );
}
