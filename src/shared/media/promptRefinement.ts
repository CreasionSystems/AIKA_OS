/**
 * 動画プロンプト補完ドメイン (純ロジック / Renderer・Main で共有可能)。
 *
 * 自由指示 (自然文) を受け、曖昧または不足のときのみ補足質問と候補チップを
 * 提示し、十分なときは最終プロンプト案と要約を返す。固定順序の質問フローは
 * 持たない。実際の高度化 (LLM による複数ターン最適化) は将来この Port を
 * 実装するアダプタへ差し替えて行う。当面は決定的な Dummy を用いる。
 */

export interface RefineInput {
  /** ユーザーの自由指示 (自然文)。 */
  instruction: string;
  /** 補足質問への回答 (question id -> 回答文)。任意。 */
  answers?: Record<string, string>;
}

/** 補足が必要: 質問と候補チップを提示する。 */
export interface FollowUpResult {
  status: "follow-up";
  questionIds: string[];
  chipIds: string[];
}

/** 十分: 最終プロンプト案と要約を返す。 */
export interface ReadyResult {
  status: "ready";
  draftPrompt: string;
  summary: string;
}

export type RefineResult = FollowUpResult | ReadyResult;

/** 補完ポート。将来 LLM アダプタへ差し替え可能。 */
export interface PromptRefinementPort {
  refine(input: RefineInput): Promise<RefineResult>;
}

/** これ以上あれば指示だけで十分とみなす文字数。 */
export const MIN_SUFFICIENT_CHARS = 15;

/** 補足質問の意味 id (表示ラベルは i18n 側)。 */
export const FOLLOW_UP_QUESTION_IDS = ["subject", "motion", "style"];

/** 候補チップの意味 id (表示ラベル・付与文言は i18n 側)。 */
export const SUGGESTION_CHIP_IDS = ["cinematic", "anime", "slowMotion", "aerial"];

/** 非空の回答値のみを順序どおり取り出す。 */
function nonEmptyAnswers(input: RefineInput): string[] {
  return Object.values(input.answers ?? {})
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** 指示 (+回答) が最終案生成に十分か。 */
export function isInstructionSufficient(input: RefineInput): boolean {
  const instr = input.instruction.trim();
  return instr.length >= MIN_SUFFICIENT_CHARS || nonEmptyAnswers(input).length > 0;
}

/** 指示と非空回答を決定的に連結して最終プロンプト案を作る (文字列連結の一元化)。 */
export function composeDraftPrompt(input: RefineInput): string {
  return [input.instruction.trim(), ...nonEmptyAnswers(input)]
    .filter((v) => v.length > 0)
    .join(" / ");
}

const SUMMARY_MAX = 48;

/** 決定的な Dummy 実装 (LLM なし)。 */
export function createDummyPromptRefinement(): PromptRefinementPort {
  return {
    async refine(input: RefineInput): Promise<RefineResult> {
      if (!isInstructionSufficient(input)) {
        return {
          status: "follow-up",
          questionIds: FOLLOW_UP_QUESTION_IDS,
          chipIds: SUGGESTION_CHIP_IDS,
        };
      }
      const draftPrompt = composeDraftPrompt(input);
      const summary =
        draftPrompt.length > SUMMARY_MAX
          ? `${draftPrompt.slice(0, SUMMARY_MAX)}…`
          : draftPrompt;
      return { status: "ready", draftPrompt, summary };
    },
  };
}
