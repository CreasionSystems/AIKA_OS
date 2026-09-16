/**
 * 動画プロンプト補完ドメイン (純ロジック / Renderer・Main で共有可能)。
 *
 * 自由指示 (自然文) を受け、曖昧または不足のときのみ補足質問と候補チップを
 * 提示し、十分なときは最終プロンプト案と要約を返す。固定順序の質問フローは
 * 持たない。実際の高度化 (LLM による複数ターン最適化) は将来この Port を
 * 実装するアダプタへ差し替えて行う。当面は決定的な Dummy を用いる。
 */

import type {
  LocalMediaAsset,
  VideoGenerationParams,
} from "./videoRequest";

export interface RefineInput {
  /** ユーザーの自由指示 (自然文)。 */
  instruction: string;
  /** 補足質問への回答 (question id -> 回答文)。任意。 */
  answers?: Record<string, string>;
  /**
   * 編集中の下書きとパラメータ候補 (ADR-001 D4)。型のみの先行で、
   * 現行の Dummy 実装は参照しない。会話履歴 turns は渡さない。
   */
  currentDraft?: string;
  currentParams?: Partial<VideoGenerationParams>;
  assets?: readonly LocalMediaAsset[];
}

/** 補足が必要: 質問と候補チップを提示する。 */
export interface FollowUpResult {
  status: "follow-up";
  questionIds: string[];
  chipIds: string[];
  /**
   * 意味 id ベースの質問 (ADR-001 D4)。型のみの先行で、接続は後続 PR。
   * 既存の questionIds は当面そのまま使う。
   */
  questions?: readonly RefinementQuestion[];
  suggestions?: readonly SuggestedParam[];
}

/** 十分: 最終プロンプト案と要約を返す。 */
export interface ReadyResult {
  status: "ready";
  draftPrompt: string;
  summary: string;
  /**
   * 構造化パラメータの候補 (ADR-001 D1/D4)。あくまで候補であり、
   * ユーザー確認を経ずに実行値にしてはならない。型のみの先行。
   */
  suggestedParams?: readonly SuggestedParam[];
}

/**
 * 補足質問。ローカライズ済み文字列ではなく意味 id を返し、Renderer が
 * i18n キーへマップする (ADR-001 D4)。port が UI 文言やロケールに依存しない。
 */
export interface RefinementQuestion {
  /** 例: "missing-source-image"。 */
  id: string;
  /** 関係する入力項目の名前。 */
  fields?: readonly string[];
}

/** 構造化パラメータの候補。根拠と確信度を添えられる。 */
export interface SuggestedParam<
  K extends keyof VideoGenerationParams = keyof VideoGenerationParams,
> {
  key: K;
  value: VideoGenerationParams[K];
  confidence?: "low" | "medium" | "high";
  /** 提案理由の意味 id。表示文言は Renderer が解決する。 */
  reasonKey?: string;
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

/** 質問 id と、関係する構造化パラメータの対応 (表示文言は持たない)。 */
export const FOLLOW_UP_QUESTIONS: readonly RefinementQuestion[] = [
  { id: "subject" },
  { id: "motion", fields: ["motionStrength"] },
  { id: "style", fields: ["qualityPreset"] },
];

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

/**
 * 指示文から構造化パラメータの候補を決定的に導く (LLM なし)。
 *
 * ADR-001 D1: ここで返すのはあくまで候補であり、そのまま実行値にしてはならない。
 * 適用はユーザーの明示操作を必要とする。
 */
export function suggestParamsFromInstruction(
  instruction: string,
): SuggestedParam[] {
  const out: SuggestedParam[] = [];
  const text = instruction;

  const duration = /(\d+)\s*秒/.exec(text);
  if (duration !== null) {
    out.push({
      key: "durationSec",
      value: Number(duration[1]),
      confidence: "high",
      reasonKey: "explicitDuration",
    });
  }

  if (text.includes("スローモーション") || text.includes("スロモ")) {
    out.push({
      key: "motionStrength",
      value: 0.2,
      confidence: "medium",
      reasonKey: "slowMotion",
    });
  }

  if (text.includes("シネマティック") || text.includes("映画")) {
    out.push({
      key: "qualityPreset",
      value: "high",
      confidence: "low",
      reasonKey: "cinematic",
    });
  }

  return out;
}

/** 決定的な Dummy 実装 (LLM なし)。 */
export function createDummyPromptRefinement(): PromptRefinementPort {
  return {
    async refine(input: RefineInput): Promise<RefineResult> {
      // questionIds は当面併存させる。renderer は questions があればそれを優先する。
      const suggestions = suggestParamsFromInstruction(input.instruction);
      if (!isInstructionSufficient(input)) {
        return {
          status: "follow-up",
          questionIds: FOLLOW_UP_QUESTION_IDS,
          chipIds: SUGGESTION_CHIP_IDS,
          questions: FOLLOW_UP_QUESTIONS,
          ...(suggestions.length > 0 ? { suggestions } : {}),
        };
      }
      const draftPrompt = composeDraftPrompt(input);
      const summary =
        draftPrompt.length > SUMMARY_MAX
          ? `${draftPrompt.slice(0, SUMMARY_MAX)}…`
          : draftPrompt;
      return {
        status: "ready",
        draftPrompt,
        summary,
        ...(suggestions.length > 0 ? { suggestedParams: suggestions } : {}),
      };
    },
  };
}
