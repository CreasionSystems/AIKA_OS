import {
  useEffect,
  useReducer,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  createDummyPromptRefinement,
  type PromptRefinementPort,
} from "@shared/media/promptRefinement";
import {
  composerReducer,
  derivePhase,
  initialComposerState,
  type RequestId,
} from "./composerReducer";
import type { VideoKind } from "@shared/inference/port";
import type { VideoCapabilityDescriptor } from "@shared/media/videoCapability";
import { DEFAULT_ASSET_REQUIREMENTS } from "@shared/media/videoCapability";
import type {
  LocalMediaAsset,
  NormalizedVideoJobRequest,
  QualityPreset,
  Resolution,
} from "@shared/media/videoRequest";
import { normalizeVideoJobRequest } from "@shared/media/videoValidation";
import type { ValidationIssue } from "@shared/media/videoValidation";

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
/**
 * 送信の結果 (ADR-001 D9)。検証失敗は例外ではなくユニオンで返す。
 * accepted の completion はジョブ完了を表し、sending 状態の区間を作る。
 */
export type ComposerSubmitOutcome =
  | { status: "accepted"; jobId: string; completion: Promise<void> }
  | { status: "invalid"; issues: readonly ValidationIssue[] };

export interface VideoPromptComposerProps {
  /** 動画種別。必要な資産入力の出し分けに使う。 */
  kind: VideoKind;
  /** source 画像パスが必須の種別か。 */
  sourceRequired: boolean;
  /**
   * テンプレート / モデルの能力記述。PR-C では受け取るだけで値域の厳密検証は
   * 行わない (concrete descriptor は後続 PR)。渡せる形だけ先に用意する。
   */
  capability?: VideoCapabilityDescriptor;
  /** 正規化済み要求の送信。検証失敗は結果ユニオン、想定外の失敗は reject。 */
  onSubmit: (req: NormalizedVideoJobRequest) => Promise<ComposerSubmitOutcome>;
  /** 補完ポート (テスト差し替え用)。既定は決定的 Dummy。 */
  refine?: PromptRefinementPort;
  /** 世代 id の採番 (テスト差し替え用)。既定は単調増加。 */
  makeRequestId?: () => RequestId;
}

const ERROR_ID = "composer-error";
const RESOLUTIONS: readonly Resolution[] = ["480p", "720p", "1080p"];
const QUALITY_PRESETS: readonly QualityPreset[] = ["draft", "standard", "high"];
const HINT_ID = "composer-keyboard-hint";

/** IME 変換中の keydown か。isComposing だけでは環境差があるため 229 も見る。 */
function isImeKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  composing: boolean,
): boolean {
  const native = event.nativeEvent;
  return composing || native.isComposing === true || native.keyCode === 229;
}

export function VideoPromptComposer({
  kind,
  sourceRequired,
  onSubmit,
  refine = createDummyPromptRefinement(),
  makeRequestId,
  capability,
}: VideoPromptComposerProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(composerReducer, initialComposerState);
  const {
    turns,
    instruction,
    answers,
    followUpIds: followUp,
    summary,
    sourceInvalid,
    errorMessage: error,
    copyState,
  } = state;
  const draft = state.draft.prompt;
  const suggestions = state.suggestions;
  const validationIssues = state.validationIssues;

  /** 指定 field に紐づく検証指摘 (無ければ undefined)。 */
  const issueFor = (field: string): ValidationIssue | undefined =>
    validationIssues.find((i) => "field" in i && i.field === field);
  /** frame 制約の指摘 (候補を持つ)。 */
  const frameIssue = validationIssues.find(
    (i): i is Extract<ValidationIssue, { code: "frame-constraint" }> =>
      i.code === "frame-constraint",
  );
  const params = state.draft.params;
  /** 種別ごとの資産パス (1件ずつ保持)。 */
  const assetPath = (k: LocalMediaAsset["kind"]) =>
    state.draft.assets.find((a) => a.kind === k)?.path ?? "";
  const sourceImage = assetPath("image");
  const phase = derivePhase(state);

  /** コピー結果の表示を自動的に消すまでの時間 (ms)。 */
  const COPY_FEEDBACK_MS = 2000;

  /** 世代 id の採番。テストからは決定的な実装を注入できる。 */
  const seqRef = useRef(0);
  const nextRequestId =
    makeRequestId ??
    (() => {
      seqRef.current += 1;
      return `req-${seqRef.current}`;
    });

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
    const timer = setTimeout(
      () => dispatch({ type: "copy-cleared" }),
      COPY_FEEDBACK_MS,
    );
    return () => clearTimeout(timer);
  }, [copyState, COPY_FEEDBACK_MS]);

  /** 最終案 (編集後) をクリップボードへ写す。失敗は握りつぶさない。 */
  async function copyDraft() {
    if (draft.trim() === "") return;
    try {
      await navigator.clipboard.writeText(draft);
      dispatch({ type: "copy-succeeded" });
    } catch {
      dispatch({ type: "copy-failed" });
    }
  }

  /** capability があればそれを、無ければ baseline を選択肢にする。 */
  const resolutionOptions = capability?.supportedResolutions ?? RESOLUTIONS;
  const qualityOptions = capability?.supportedQualityPresets ?? QUALITY_PRESETS;
  const fpsOptions = capability?.allowedFps;

  /**
   * capability が届いたら初期値を descriptor の defaults に置き換える。
   * 未取得・取得失敗時は PR-E の visible default が fallback として残る。
   */
  useEffect(() => {
    if (capability === undefined) return;
    dispatch({
      type: "capability-defaults-applied",
      params: capability.defaults,
    });
  }, [capability]);

  /** 種別に必要な資産入力 (required は baseline の最小数から判断する)。 */
  const assetKinds = DEFAULT_ASSET_REQUIREMENTS[kind].map((r) => ({
    kind: r.kind,
    required: r.min > 0,
  }));

  /** 数値欄は空を未入力として扱い、丸めや補正は行わない。 */
  function setNumberParam(
    key: "durationSec" | "fps" | "motionStrength",
    raw: string,
  ) {
    dispatch({
      type: "param-changed",
      key,
      value: raw === "" ? undefined : Number(raw),
    });
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
      case "checking":
        return t("media.composer.status.checking");
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

  /**
   * 指示 + 回答を補完ポートへ渡す。完了は requestId を伴い、進行中の世代と
   * 一致しない結果は reducer が捨てる (古い応答で状態を上書きしない)。
   */
  async function compose(requestId: RequestId) {
    try {
      const result = await refine.refine({ instruction, answers });
      dispatch({
        type: "refinement-succeeded",
        requestId,
        at: Date.now(),
        result,
      });
    } catch (err) {
      dispatch({
        type: "refinement-failed",
        requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onComposeSubmit(event: FormEvent) {
    event.preventDefault();
    if (instruction.trim() === "") return;
    // 処理中の連打 (Enter / ボタンとも) で二重に走らせない。
    if (phase === "validating") return;
    const requestId = nextRequestId();
    const at = Date.now();
    if (followUp === null) {
      dispatch({ type: "instruction-submitted", requestId, at });
    } else {
      dispatch({
        type: "follow-up-answered",
        requestId,
        at,
        text: Object.values(answers)
          .map((v) => v.trim())
          .filter((v) => v !== "")
          .join(" / "),
      });
    }
    void compose(requestId);
  }

  function appendChip(text: string) {
    dispatch({ type: "chip-appended", text });
  }

  function setAnswer(id: string, value: string) {
    dispatch({ type: "answer-changed", id, text: value });
  }

  function onSendSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  async function send() {
    if (phase === "sending" || phase === "checking") return;
    if (draft.trim() === "") return;
    if (sourceRequired && sourceImage.trim() === "") {
      // ready のまま alert を表示し、source を修正して再送信できる。
      dispatch({
        type: "send-rejected-locally",
        message: t("media.error.sourceRequired"),
      });
      return;
    }
    const requestId = nextRequestId();
    dispatch({ type: "send-requested", requestId });

    // renderer 側の早期検証。main も同じ共有純粋関数で再検証する (ADR-001 D6)。
    const local = normalizeVideoJobRequest(kind, state.draft, capability);
    if (!local.valid) {
      dispatch({ type: "validation-failed", requestId, issues: local.issues });
      return;
    }

    try {
      const outcome = await onSubmit(local.request);
      if (outcome.status === "invalid") {
        dispatch({
          type: "validation-failed",
          requestId,
          issues: outcome.issues,
        });
        return;
      }
      dispatch({ type: "send-accepted", requestId, jobId: outcome.jobId });
      await outcome.completion;
      dispatch({ type: "send-succeeded", requestId });
    } catch (err) {
      dispatch({
        type: "send-failed",
        requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** すべて初期化して idle へ。 */
  function reset() {
    dispatch({ type: "reset-requested" });
  }

  /** 最終案の編集へ戻る (指示は保持)。 */
  function redo() {
    dispatch({ type: "redo-requested" });
  }

  const composing =
    phase === "validating" || phase === "checking" || phase === "sending";
  const showComposeForm =
    phase === "idle" || phase === "validating" || phase === "follow-up";
  const showReady =
    phase === "ready" || phase === "checking" || phase === "sending";

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

      {/* 会話ログ。末尾への追加のみ読み上げる。見た目のチャット化はしない。 */}
      <section aria-label={t("media.composer.log.label")}>
        <div role="log" aria-live="polite" aria-relevant="additions">
          {turns.map((turn) => (
            <p key={turn.id}>
              <span>
                {turn.role === "user"
                  ? t("media.composer.turn.user")
                  : t("media.composer.turn.assistant")}
                {": "}
              </span>
              <span>
                {turn.text ??
                  (turn.messageKey
                    ? t(turn.messageKey, turn.values ?? {})
                    : "")}
              </span>
            </p>
          ))}
        </div>
      </section>

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
              dispatch({ type: "instruction-changed", text: e.target.value });
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
              dispatch({ type: "draft-changed", text: e.target.value });
              autoGrow(e.target);
            }}
          />
          <p id={HINT_ID}>{t("media.composer.hint.enterToSend")}</p>

          {/* 補完が出した候補。自動適用はせず、ユーザーが明示的に適用する
              (ADR-001 D1)。説明的な本文のため live region には入れない。 */}
          {suggestions.length > 0 && (
            <section aria-label={t("media.composer.suggestions.title")}>
              <h3>{t("media.composer.suggestions.title")}</h3>
              <ul>
                {suggestions.map((s) => (
                  <li key={s.key}>
                    <span>
                      {t(`media.composer.params.${s.key}`)}: {String(s.value)}
                    </span>
                    {s.reasonKey !== undefined && (
                      <span>{t(`media.composer.reason.${s.reasonKey}`)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({ type: "suggestion-applied", key: s.key })
                      }
                    >
                      {t("media.composer.suggestions.apply")}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => dispatch({ type: "suggestions-dismissed" })}
              >
                {t("media.composer.suggestions.dismiss")}
              </button>
            </section>
          )}

          {/* 構造化パラメータ。値域はモデル依存のため、ここでは軽い UI guard のみ。 */}
          <fieldset>
            <legend>{t("media.composer.params.title")}</legend>

            <label htmlFor="composer-duration">
              {t("media.composer.params.durationSec")}
            </label>
            <input
              id="composer-duration"
              type="number"
              min={0}
              step="any"
              value={params.durationSec ?? ""}
              onChange={(e) => setNumberParam("durationSec", e.target.value)}
              aria-invalid={issueFor("durationSec") !== undefined}
              aria-describedby={
                issueFor("durationSec") !== undefined
                  ? "composer-issue-durationSec"
                  : undefined
              }
            />
            {issueFor("durationSec") !== undefined && (
              <span id="composer-issue-durationSec">
                {t(issueFor("durationSec")!.messageKey)}
              </span>
            )}

            <label htmlFor="composer-fps">{t("media.composer.params.fps")}</label>
            {fpsOptions !== undefined ? (
              // capability があるときは許容値だけを選ばせる。
              <select
                id="composer-fps"
                value={params.fps ?? ""}
                onChange={(e) => setNumberParam("fps", e.target.value)}
                aria-invalid={issueFor("fps") !== undefined}
              >
                <option value="">{t("media.composer.params.unset")}</option>
                {fpsOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            ) : (
            <input
              id="composer-fps"
              type="number"
              min={1}
              step={1}
              value={params.fps ?? ""}
              onChange={(e) => setNumberParam("fps", e.target.value)}
              aria-invalid={issueFor("fps") !== undefined}
              aria-describedby={
                issueFor("fps") !== undefined ? "composer-issue-fps" : undefined
              }
            />
            )}
            {issueFor("fps") !== undefined && (
              <span id="composer-issue-fps">
                {t(issueFor("fps")!.messageKey)}
              </span>
            )}

            <label htmlFor="composer-resolution">
              {t("media.composer.params.resolution")}
            </label>
            <select
              id="composer-resolution"
              value={params.resolution ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "param-changed",
                  key: "resolution",
                  value:
                    e.target.value === ""
                      ? undefined
                      : (e.target.value as Resolution),
                })
              }
            >
              <option value="">{t("media.composer.params.unset")}</option>
              {resolutionOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <label htmlFor="composer-quality">
              {t("media.composer.params.qualityPreset")}
            </label>
            <select
              id="composer-quality"
              value={params.qualityPreset ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "param-changed",
                  key: "qualityPreset",
                  value:
                    e.target.value === ""
                      ? undefined
                      : (e.target.value as QualityPreset),
                })
              }
            >
              <option value="">{t("media.composer.params.unset")}</option>
              {qualityOptions.map((q) => (
                <option key={q} value={q}>
                  {t(`media.composer.quality.${q}`)}
                </option>
              ))}
            </select>

            <label htmlFor="composer-motion">
              {t("media.composer.params.motionStrength")}
            </label>
            <input
              id="composer-motion"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={params.motionStrength ?? 0}
              onChange={(e) => setNumberParam("motionStrength", e.target.value)}
              aria-describedby="composer-motion-value"
            />
            {/* スライダーの現在値はテキストでも読めるようにする。 */}
            <span id="composer-motion-value">
              {(params.motionStrength ?? 0).toFixed(2)}
            </span>
          </fieldset>

          {/* 資産入力は種別ごとに出し分ける。image は既存ラベルを維持する。 */}
          {assetKinds.map(({ kind: assetKind, required }) => {
            const isImage = assetKind === "image";
            const invalid = isImage && sourceInvalid;
            return (
              <div key={assetKind}>
                <label htmlFor={`composer-asset-${assetKind}`}>
                  {isImage
                    ? t("media.source.label")
                    : t(`media.composer.asset.${assetKind}`)}
                </label>
                <input
                  id={`composer-asset-${assetKind}`}
                  type="text"
                  value={assetPath(assetKind)}
                  // required 属性はブラウザ既定の制約検証で submit を止め、
                  // 独自の alert 表示を奪うため使わない (a11y 規約を優先)。
                  aria-required={required}
                  onChange={(e) =>
                    dispatch({
                      type: "asset-changed",
                      kind: assetKind,
                      path: e.target.value,
                    })
                  }
                  aria-invalid={invalid}
                  aria-describedby={invalid ? ERROR_ID : undefined}
                />
              </div>
            );
          })}

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

      {/* 検証の失敗は form-level に要約1件だけ出す。明細は各入力欄に置く。 */}
      {validationIssues.length > 0 && (
        <p role="alert">{t("media.validation.summary")}</p>
      )}

      {/* frame 制約の修正候補。自動適用はせず、明示操作でのみ draft を変える。 */}
      {frameIssue !== undefined && frameIssue.suggestions.length > 0 && (
        <section aria-label={t("media.composer.frameSuggestion.title")}>
          <ul>
            {frameIssue.suggestions.map((s) => (
              <li key={s.frameCount}>
                <span>
                  {s.durationSec} / {s.frameCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "param-changed",
                      key: "durationSec",
                      value: s.durationSec,
                    })
                  }
                >
                  {t("media.composer.frameSuggestion.apply")}
                </button>
              </li>
            ))}
          </ul>
        </section>
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
