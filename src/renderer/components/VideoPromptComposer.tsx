import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
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
 *
 * キーボード: Enter で送信、Shift+Enter で改行。送信はボタン・Enter とも
 * form の onSubmit に一本化する (Enter は requestSubmit() に委ねる)。
 * 日本語 IME の変換確定 Enter を誤送信しないよう、isComposing /
 * compositionstart-end の ref / keyCode===229 の3層でガードする。
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
const HINT_ID = "composer-keyboard-hint";

/** コピーの結果表示。phase (送信の状態機械) とは独立に扱う。 */
type CopyState = "idle" | "copied" | "failed";

/** IME 変換中の keydown か。isComposing だけでは環境差があるため 229 も見る。 */
function isImeKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  composing: boolean,
): boolean {
  const native = event.nativeEvent;
  return composing || native.isComposing === true || native.keyCode === 229;
}

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
  const [copyState, setCopyState] = useState<CopyState>("idle");

  /** コピー結果の表示を自動的に消すまでの時間 (ms)。 */
  const COPY_FEEDBACK_MS = 2000;

  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const composeFormRef = useRef<HTMLFormElement | null>(null);
  const sendFormRef = useRef<HTMLFormElement | null>(null);
  /** IME 変換中か (compositionstart -> compositionend)。 */
  const composingRef = useRef(false);

  /**
   * Enter で form の送信を要求する。Shift+Enter は textarea 標準の改行に委ね、
   * IME 変換中の Enter は何もしない。実処理は form の onSubmit 側にある。
   */
  function handleEnterKey(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    formRef: RefObject<HTMLFormElement | null>,
  ) {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (isImeKeyDown(event, composingRef.current)) return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  }

  const compositionHandlers = {
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
    },
  };

  /** コピー結果の表示は一定時間で消す。送信の状態機械には影響しない。 */
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyState, COPY_FEEDBACK_MS]);

  /** 最終案 (編集後) をクリップボードへ写す。失敗は握りつぶさない。 */
  async function copyDraft() {
    if (draft.trim() === "") return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

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
    // 処理中の連打 (Enter / ボタンとも) で二重に走らせない。
    if (phase === "validating") return;
    void compose();
  }

  function appendChip(text: string) {
    setInstruction((prev) => (prev.trim() === "" ? text : `${prev} ${text}`));
  }

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function onSendSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  async function send() {
    if (phase === "sending") return;
    if (draft.trim() === "") return;
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
      {/* 送信状態。live region は初回レンダリングから置く。 */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("media.composer.status.label")}
      >
        {statusText()}
      </p>

      {/* コピー結果。送信状態とは混ぜず、名前で識別できるようにする。 */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("media.composer.status.copyLabel")}
      >
        {copyState === "copied" ? t("media.composer.status.copied") : ""}
      </p>

      {showComposeForm && (
        <form ref={composeFormRef} onSubmit={onComposeSubmit}>
          <label htmlFor="composer-instruction">
            {t("media.composer.instruction.label")}
          </label>
          <textarea
            id="composer-instruction"
            ref={instructionRef}
            rows={3}
            value={instruction}
            placeholder={t("media.composer.instruction.placeholder")}
            aria-describedby={HINT_ID}
            onKeyDown={(e) => handleEnterKey(e, composeFormRef)}
            {...compositionHandlers}
            onChange={(e) => {
              setInstruction(e.target.value);
              autoGrow(e.target);
            }}
          />
          {/* 操作の手掛かり。live region の外に置く。 */}
          <p id={HINT_ID}>{t("media.composer.hint.enterToSend")}</p>

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
        <form ref={sendFormRef} onSubmit={onSendSubmit}>
          <h3>{t("media.composer.summary.title")}</h3>
          <p>{summary}</p>

          <label htmlFor="composer-final">
            {t("media.composer.finalPrompt.label")}
          </label>
          <textarea
            id="composer-final"
            rows={3}
            value={draft}
            aria-describedby={HINT_ID}
            onKeyDown={(e) => handleEnterKey(e, sendFormRef)}
            {...compositionHandlers}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.target);
            }}
          />
          <p id={HINT_ID}>{t("media.composer.hint.enterToSend")}</p>

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
            onClick={() => void copyDraft()}
            disabled={composing || draft.trim() === ""}
          >
            {t("media.composer.action.copy")}
          </button>
          <button type="submit" disabled={composing || draft.trim() === ""}>
            {t("media.composer.action.send")}
          </button>
          <button type="button" onClick={reset} disabled={composing}>
            {t("media.composer.action.redo")}
          </button>
        </form>
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

      {/* コピー失敗は握りつぶさず、失敗としてだけ alert に出す。 */}
      {copyState === "failed" && (
        <p role="alert" aria-label={t("media.composer.error.copyLabel")}>
          {t("media.composer.error.copyFailed")}
        </p>
      )}
    </div>
  );
}
