import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  createDummyPromptRefinement,
  type PromptRefinementPort,
} from "@shared/media/promptRefinement";

/**
 * 動画プロンプトの対話型コンポーザ。
 *
 * 自由指示 (自然文) を主軸に、曖昧/不足のときのみ補足質問と候補チップを提示し、
 * 十分なら最終プロンプト案を生成する。ユーザーは最終案を確認・編集してから送信
 * できる。固定順序の質問フローは持たない。
 *
 * 状態機械: idle -> validating -> (follow-up ->)* ready -> sending -> success
 *           いずれの非同期段でも失敗すれば error (retry/やり直し可)。
 * 補完ロジックは PromptRefinementPort として注入可能 (既定は決定的な Dummy)。
 * 将来 LLM ベースの複数ターン最適化アダプタへ差し替えられる。
 *
 * a11y: 短い状態サマリーのみ live region、失敗のみ role="alert"、
 * すべての操作はキーボードで到達可能 (button / input / textarea)。
 */
type Phase =
  | "idle"
  | "validating"
  | "follow-up"
  | "ready"
  | "sending"
  | "success"
  | "error";

export interface VideoPromptComposerProps {
  /** source 画像パスが必須の種別か。 */
  sourceRequired: boolean;
  /** 最終プロンプトの送信。成功で解決、失敗で reject。 */
  onSubmit: (req: { prompt: string; sourceImage?: string }) => Promise<void>;
  /** 補完ポート (テスト差し替え用)。既定は決定的 Dummy。 */
  refine?: PromptRefinementPort;
}

const ERROR_ID = "composer-error";

export function VideoPromptComposer({
  sourceRequired,
  onSubmit,
  refine = createDummyPromptRefinement(),
}: VideoPromptComposerProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [instruction, setInstruction] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [followUp, setFollowUp] = useState<{
    questionIds: string[];
    chipIds: string[];
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceImage, setSourceImage] = useState("");
  const [sourceInvalid, setSourceInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instructionRef = useRef<HTMLTextAreaElement | null>(null);

  /** 複数行入力を内容に応じて自動拡張する。 */
  function autoGrow(el: HTMLTextAreaElement | null) {
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function statusText(): string {
    switch (phase) {
      case "validating":
        return t("media.composer.status.validating");
      case "follow-up":
        return t("media.composer.status.followup");
      case "ready":
        return t("media.composer.status.ready");
      case "sending":
        return t("media.composer.status.sending");
      case "success":
        return t("media.composer.status.success");
      case "error":
        return t("media.composer.status.error");
      default:
        return t("media.composer.status.idle");
    }
  }

  /** 指示 + 回答を補完ポートへ渡し、follow-up か ready へ遷移する。 */
  async function compose(nextAnswers: Record<string, string> = answers) {
    setError(null);
    setPhase("validating");
    try {
      const result = await refine.refine({ instruction, answers: nextAnswers });
      if (result.status === "follow-up") {
        setFollowUp({
          questionIds: result.questionIds,
          chipIds: result.chipIds,
        });
        setPhase("follow-up");
      } else {
        setDraft(result.draftPrompt);
        setSummary(result.summary);
        setPhase("ready");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  function onComposeSubmit(event: FormEvent) {
    event.preventDefault();
    if (instruction.trim() === "") return;
    void compose();
  }

  function appendChip(text: string) {
    setInstruction((prev) => (prev.trim() === "" ? text : `${prev} ${text}`));
  }

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function send() {
    setError(null);
    setSourceInvalid(false);
    if (sourceRequired && sourceImage.trim() === "") {
      setSourceInvalid(true);
      setError(t("media.error.sourceRequired"));
      // ready のまま alert を表示し、source を修正して再送信できる。
      return;
    }
    setPhase("sending");
    try {
      await onSubmit({
        prompt: draft,
        ...(sourceRequired ? { sourceImage } : {}),
      });
      setPhase("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  /** すべて初期化して idle へ。 */
  function reset() {
    setInstruction("");
    setAnswers({});
    setFollowUp(null);
    setDraft("");
    setSummary("");
    setSourceImage("");
    setSourceInvalid(false);
    setError(null);
    setPhase("idle");
  }

  /** 最終案の編集へ戻る (指示は保持)。 */
  function redo() {
    setError(null);
    setPhase("ready");
  }

  const composing = phase === "validating" || phase === "sending";
  const showComposeForm =
    phase === "idle" || phase === "validating" || phase === "follow-up";
  const showReady = phase === "ready" || phase === "sending";

  return (
    <div>
      {/* 短い状態サマリーのみ live region に置く。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {statusText()}
      </p>

      {showComposeForm && (
        <form onSubmit={onComposeSubmit}>
          <label htmlFor="composer-instruction">
            {t("media.composer.instruction.label")}
          </label>
          <textarea
            id="composer-instruction"
            ref={instructionRef}
            rows={3}
            value={instruction}
            placeholder={t("media.composer.instruction.placeholder")}
            onChange={(e) => {
              setInstruction(e.target.value);
              autoGrow(e.target);
            }}
          />

          {phase === "follow-up" && followUp !== null && (
            <div>
              <h3>{t("media.composer.followup.title")}</h3>
              {followUp.questionIds.map((id) => (
                <div key={id}>
                  <label htmlFor={`composer-q-${id}`}>
                    {t(`media.composer.question.${id}`)}
                  </label>
                  <input
                    id={`composer-q-${id}`}
                    type="text"
                    value={answers[id] ?? ""}
                    onChange={(e) => setAnswer(id, e.target.value)}
                  />
                </div>
              ))}

              <div aria-label={t("media.composer.chips.title")}>
                {followUp.chipIds.map((id) => {
                  const text = t(`media.composer.chip.${id}`);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => appendChip(text)}
                    >
                      {text}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={composing || instruction.trim() === ""}
          >
            {phase === "follow-up"
              ? t("media.composer.action.continue")
              : t("media.composer.action.compose")}
          </button>
        </form>
      )}

      {showReady && (
        <div>
          <h3>{t("media.composer.summary.title")}</h3>
          <p>{summary}</p>

          <label htmlFor="composer-final">
            {t("media.composer.finalPrompt.label")}
          </label>
          <textarea
            id="composer-final"
            rows={3}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.target);
            }}
          />

          {sourceRequired && (
            <>
              <label htmlFor="composer-source">{t("media.source.label")}</label>
              <input
                id="composer-source"
                type="text"
                value={sourceImage}
                onChange={(e) => setSourceImage(e.target.value)}
                aria-invalid={sourceInvalid}
                aria-describedby={sourceInvalid ? ERROR_ID : undefined}
              />
            </>
          )}

          <button
            type="button"
            onClick={() => void send()}
            disabled={composing || draft.trim() === ""}
          >
            {t("media.composer.action.send")}
          </button>
          <button type="button" onClick={reset} disabled={composing}>
            {t("media.composer.action.redo")}
          </button>
        </div>
      )}

      {phase === "success" && (
        <button type="button" onClick={reset}>
          {t("media.composer.action.reset")}
        </button>
      )}

      {phase === "error" && (
        <div>
          <button type="button" onClick={() => void send()}>
            {t("media.composer.action.retry")}
          </button>
          <button type="button" onClick={redo}>
            {t("media.composer.action.redo")}
          </button>
        </div>
      )}

      {error !== null && (
        <p role="alert" id={ERROR_ID}>
          {error}
        </p>
      )}
    </div>
  );
}
