/**
 * 動画プロンプトコンポーザの状態モデル (ADR-001 D5 / D7)。
 *
 * - turns は表示用の会話ログ。requestId や copyState などの処理状態を持たない。
 * - OperationState は非表示の処理状態。follow-up / ready は処理状態ではないため
 *   持たせず、turns と draft から派生させる (derivePhase)。
 * - 非同期の完了は必ず requestId を伴い、進行中の世代と一致しない結果は捨てる。
 *
 * ADR-001 との段階的適用:
 * - success.jobId は最終形では持つが、onSubmit が Promise<void> のため PR-B では
 *   省略する (PR-E で IPC 契約を開く際に追加して一致させる)。
 * - validating は Main 側 validation 接続時 (PR-E) に実体化する。PR-B では
 *   operation.refining の派生表示で代替する。
 */

import type {
  RefineResult,
  SuggestedParam,
} from "@shared/media/promptRefinement";
import type {
  LocalMediaAsset,
  VideoDraft,
  VideoGenerationParams,
} from "@shared/media/videoRequest";
import type { ValidationIssue } from "@shared/media/videoValidation";
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_FPS,
  DEFAULT_MOTION_STRENGTH,
  DEFAULT_QUALITY_PRESET,
  DEFAULT_RESOLUTION,
} from "@shared/media/videoRequest";

/** 非同期処理の世代 id。 */
export type RequestId = string;

/** 会話ログの1ターン。表示用モデル。 */
export interface ConversationTurn {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "instruction" | "answer" | "follow-up" | "draft" | "validation";
  /** ユーザー発話はそのまま表示する本文。 */
  text?: string;
  /** アシスタント / システム発話は i18n キーで持つ (6ロケール網羅を保つため)。 */
  messageKey?: string;
  values?: Readonly<Record<string, string | number>>;
  createdAt: number;
}

/** 非表示の処理状態。会話本文には出さない。 */
export type OperationState =
  | { status: "idle" }
  | { status: "refining"; requestId: RequestId }
  /** 送信要求を受けてから、正規化・検証・受理判定が終わるまで。 */
  | { status: "validating"; requestId: RequestId }
  /** main 側で受理され、ジョブ投入処理が進んでいる間。 */
  | { status: "sending"; requestId: RequestId; jobId: string }
  | { status: "success"; requestId: RequestId; jobId: string }
  | { status: "error"; requestId: RequestId; message: string };

/** コピーの結果表示。送信の状態機械から独立 (#19)。 */
export type CopyState = "idle" | "copied" | "failed";

export interface ComposerState {
  turns: readonly ConversationTurn[];
  instruction: string;
  answers: Readonly<Record<string, string>>;
  followUpIds: {
    questionIds: readonly string[];
    chipIds: readonly string[];
  } | null;
  /**
   * 送信される内容 (prompt / params / assets)。answers と summary は
   * refinement の副産物で NormalizedVideoJobRequest に含まれないため、
   * draft には入れず ComposerState 直下に置く (ADR-001 D1)。
   */
  draft: VideoDraft;
  /**
   * 補完がドラフトを提示済みか。ready の導出根拠を「本文が非空か」にすると、
   * ユーザーが最終案を全消しして打ち直す間だけ ready 画面が消えてしまうため、
   * 本文ではなく「提示済みか」で判定する。
   */
  draftProduced: boolean;
  summary: string;
  /**
   * refinement が返した構造化パラメータの候補 (ADR-001 D1)。
   * draft.params とは別に保持し、ユーザーが適用したときだけ draft へ入る。
   */
  suggestions: readonly SuggestedParam[];
  /**
   * 検証由来の指摘 (PR-E)。refinement の候補とは発生理由も消える条件も
   * 異なるため、同じ配列に入れない。
   */
  validationIssues: readonly ValidationIssue[];
  sourceInvalid: boolean;
  /** alert に出す本文。ローカル検証の拒否でも使うため operation とは分ける。 */
  errorMessage: string | null;
  operation: OperationState;
  copyState: CopyState;
  /** ターン id の採番用。表示には使わない。 */
  seq: number;
}

/** 表示用の段階。処理状態と会話・draft から導く。 */
export type DisplayPhase =
  | "idle"
  | "validating"
  | "checking"
  | "follow-up"
  | "ready"
  | "sending"
  | "success"
  | "error";

export const initialComposerState: ComposerState = {
  turns: [],
  instruction: "",
  answers: {},
  followUpIds: null,
  draft: {
    prompt: "",
    // 画面上に見える初期値。値域ではない (ADR-001 D3b 注記)。
    params: {
      durationSec: DEFAULT_DURATION_SEC,
      fps: DEFAULT_FPS,
      resolution: DEFAULT_RESOLUTION,
      qualityPreset: DEFAULT_QUALITY_PRESET,
      motionStrength: DEFAULT_MOTION_STRENGTH,
    },
    assets: [],
  },
  draftProduced: false,
  summary: "",
  suggestions: [],
  validationIssues: [],
  sourceInvalid: false,
  errorMessage: null,
  operation: { status: "idle" },
  copyState: "idle",
  seq: 0,
};

/** 旧 phase と同じ意味を、状態の組み合わせから導出する。 */
export function derivePhase(state: ComposerState): DisplayPhase {
  switch (state.operation.status) {
    case "refining":
      return "validating";
    case "validating":
      return "checking";
    case "sending":
      return "sending";
    case "success":
      return "success";
    case "error":
      return "error";
    case "idle":
      break;
  }
  if (state.draftProduced) return "ready";
  if (state.followUpIds !== null) return "follow-up";
  return "idle";
}

export type ComposerAction =
  | { type: "instruction-changed"; text: string }
  | { type: "answer-changed"; id: string; text: string }
  | { type: "draft-changed"; text: string }
  | {
      type: "param-changed";
      key: keyof VideoGenerationParams;
      value: VideoGenerationParams[keyof VideoGenerationParams] | undefined;
    }
  | { type: "asset-changed"; kind: LocalMediaAsset["kind"]; path: string }
  | { type: "chip-appended"; text: string }
  | { type: "instruction-submitted"; requestId: RequestId; at: number }
  | { type: "follow-up-answered"; requestId: RequestId; at: number; text: string }
  | {
      type: "refinement-succeeded";
      requestId: RequestId;
      at: number;
      result: RefineResult;
    }
  | { type: "refinement-failed"; requestId: RequestId; message: string }
  | { type: "send-requested"; requestId: RequestId }
  | { type: "send-rejected-locally"; message: string }
  | {
      type: "validation-failed";
      requestId: RequestId;
      issues: readonly ValidationIssue[];
    }
  | { type: "send-accepted"; requestId: RequestId; jobId: string }
  | { type: "send-succeeded"; requestId: RequestId }
  | { type: "send-failed"; requestId: RequestId; message: string }
  | { type: "suggestion-applied"; key: SuggestedParam["key"] }
  | { type: "suggestions-dismissed" }
  | { type: "redo-requested" }
  | { type: "reset-requested" }
  | { type: "copy-succeeded" }
  | { type: "copy-failed" }
  | { type: "copy-cleared" };

/** 進行中の世代と一致する完了かどうか。 */
function isCurrent(
  operation: OperationState,
  status: "refining" | "validating" | "sending",
  requestId: RequestId,
): boolean {
  return operation.status === status && operation.requestId === requestId;
}

function withTurn(
  state: ComposerState,
  turn: Omit<ConversationTurn, "id">,
): ComposerState {
  return {
    ...state,
    turns: [...state.turns, { ...turn, id: `turn-${state.seq}` }],
    seq: state.seq + 1,
  };
}

export function composerReducer(
  state: ComposerState,
  action: ComposerAction,
): ComposerState {
  switch (action.type) {
    case "instruction-changed":
      return { ...state, instruction: action.text };

    case "answer-changed":
      return {
        ...state,
        answers: { ...state.answers, [action.id]: action.text },
      };

    case "draft-changed":
      return { ...state, draft: { ...state.draft, prompt: action.text } };

    case "param-changed": {
      const params = { ...state.draft.params };
      const rest = state.validationIssues.filter(
        (i) => !("field" in i) || i.field !== action.key,
      );
      if (action.value === undefined) {
        delete params[action.key];
      } else {
        // key と value は呼び出し側で対応付けているため、ここでは代入のみ行う。
        (params as Record<string, unknown>)[action.key] = action.value;
      }
      return {
        ...state,
        draft: { ...state.draft, params },
        validationIssues: rest,
      };
    }

    case "asset-changed": {
      // 種別ごとに1件を保持する。空文字は取り下げとして扱う。
      const rest = state.draft.assets.filter((a) => a.kind !== action.kind);
      const assets =
        action.path.trim() === ""
          ? rest
          : [...rest, { kind: action.kind, path: action.path }];
      return {
        ...state,
        draft: { ...state.draft, assets },
        sourceInvalid: false,
        // 該当入力を直したら、ローカル拒否のエラー表示は解除する。
        errorMessage: state.sourceInvalid ? null : state.errorMessage,
      };
    }

    case "chip-appended":
      return {
        ...state,
        instruction:
          state.instruction.trim() === ""
            ? action.text
            : `${state.instruction} ${action.text}`,
      };

    case "instruction-submitted":
      return withTurn(
        {
          ...state,
          errorMessage: null,
          operation: { status: "refining", requestId: action.requestId },
        },
        {
          role: "user",
          kind: "instruction",
          text: state.instruction,
          createdAt: action.at,
        },
      );

    case "follow-up-answered":
      return withTurn(
        {
          ...state,
          errorMessage: null,
          operation: { status: "refining", requestId: action.requestId },
        },
        {
          role: "user",
          kind: "answer",
          text: action.text,
          createdAt: action.at,
        },
      );

    case "refinement-succeeded": {
      if (!isCurrent(state.operation, "refining", action.requestId)) return state;
      // 候補は draft.params へ自動反映しない。適用はユーザーの明示操作のみ。
      const suggestions =
        action.result.status === "follow-up"
          ? (action.result.suggestions ?? [])
          : (action.result.suggestedParams ?? []);
      if (action.result.status === "follow-up") {
        return withTurn(
          {
            ...state,
            followUpIds: {
              questionIds: action.result.questionIds,
              chipIds: action.result.chipIds,
            },
            suggestions,
            operation: { status: "idle" },
          },
          {
            role: "assistant",
            kind: "follow-up",
            messageKey: "media.composer.turn.followUp",
            createdAt: action.at,
          },
        );
      }
      return withTurn(
        {
          ...state,
          draft: { ...state.draft, prompt: action.result.draftPrompt },
          draftProduced: true,
          summary: action.result.summary,
          suggestions,
          operation: { status: "idle" },
        },
        {
          role: "assistant",
          kind: "draft",
          // 候補の詳細は会話本文に出さず、件数だけを事実として伝える。
          messageKey:
            suggestions.length > 0
              ? "media.composer.turn.draftWithSuggestions"
              : "media.composer.turn.draft",
          ...(suggestions.length > 0
            ? { values: { count: suggestions.length } }
            : {}),
          createdAt: action.at,
        },
      );
    }

    case "refinement-failed":
      if (!isCurrent(state.operation, "refining", action.requestId)) return state;
      return {
        ...state,
        errorMessage: action.message,
        operation: {
          status: "error",
          requestId: action.requestId,
          message: action.message,
        },
      };

    case "send-requested":
      return {
        ...state,
        errorMessage: null,
        sourceInvalid: false,
        validationIssues: [],
        operation: { status: "validating", requestId: action.requestId },
      };

    // 検証失敗は error にせず ready へ戻し、入力を保持したまま明細を出す。
    case "validation-failed":
      if (!isCurrent(state.operation, "validating", action.requestId)) {
        return state;
      }
      return {
        ...state,
        validationIssues: action.issues,
        operation: { status: "idle" },
      };

    case "send-accepted":
      if (!isCurrent(state.operation, "validating", action.requestId)) {
        return state;
      }
      return {
        ...state,
        operation: {
          status: "sending",
          requestId: action.requestId,
          jobId: action.jobId,
        },
      };

    // source 未入力などの手前で弾く検証。ready のまま修正・再送信できる。
    case "send-rejected-locally":
      return { ...state, sourceInvalid: true, errorMessage: action.message };

    case "send-succeeded": {
      if (!isCurrent(state.operation, "sending", action.requestId)) return state;
      const jobId =
        state.operation.status === "sending" ? state.operation.jobId : "";
      return {
        ...state,
        operation: { status: "success", requestId: action.requestId, jobId },
      };
    }

    case "send-failed":
      if (
        !isCurrent(state.operation, "sending", action.requestId) &&
        !isCurrent(state.operation, "validating", action.requestId)
      ) {
        return state;
      }
      return {
        ...state,
        errorMessage: action.message,
        operation: {
          status: "error",
          requestId: action.requestId,
          message: action.message,
        },
      };

    case "suggestion-applied": {
      const target = state.suggestions.find((s) => s.key === action.key);
      if (target === undefined) return state;
      const params = { ...state.draft.params };
      (params as Record<string, unknown>)[target.key] = target.value;
      return {
        ...state,
        draft: { ...state.draft, params },
        // 適用済みの候補は一覧から取り除く。
        suggestions: state.suggestions.filter((s) => s.key !== action.key),
      };
    }

    case "suggestions-dismissed":
      // draft.params は変更しない。
      return { ...state, suggestions: [] };

    case "redo-requested":
      return {
        ...state,
        errorMessage: null,
        validationIssues: [],
        operation: { status: "idle" },
      };

    case "reset-requested":
      return { ...initialComposerState, seq: state.seq };

    case "copy-succeeded":
      return { ...state, copyState: "copied" };

    case "copy-failed":
      return { ...state, copyState: "failed" };

    case "copy-cleared":
      return { ...state, copyState: "idle" };
  }
}
