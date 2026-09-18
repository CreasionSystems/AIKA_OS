import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getAikaApi } from "@preload/windowApi";
import { WRITING_MODES } from "@shared/writing/writingModes";
import type { WritingViolation } from "@shared/writing/writingModes";
import type { WritingMode } from "@shared/inference/port";

/** 想定外の失敗に使う表示用の意味 ID。内部情報は一切出さない。 */
const GENERIC_ERROR_KEY = "writing.error.generationFailed";

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

  /**
   * 違反明細を表示文言にする。ロケール文字列は明細に含まれず、ここで決まる。
   * モード名は補間前に翻訳する (明細はコードだけを運ぶ)。
   */
  function issueText(issue: WritingViolation): string {
    const params = { ...(issue.messageParams ?? {}) };
    if (typeof params.mode === "string") {
      params.mode = t(`writing.mode.option.${params.mode}`);
    }
    return t(issue.messageKey, params);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("running");
    setError(null);
    setResult(null);
    try {
      const res = await getAikaApi().generateText({ mode, prompt });
      if (res.status === "succeeded") {
        setResult(res.result.text);
        setStatus("idle");
        return;
      }
      if (res.status === "invalid") {
        setError(res.issues.map(issueText).join(" / "));
        setStatus("error");
        return;
      }
      setError(t(res.messageKey, res.messageParams ?? {}));
      setStatus("error");
    } catch {
      // IPC 自体の失敗 (プロセス断など) は依然 reject しうる。
      // 生の err.message は channel 名を含むため表示しない。
      setError(t(GENERIC_ERROR_KEY));
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
