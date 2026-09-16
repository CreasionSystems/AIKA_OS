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

import type { RefineResult } from "@shared/media/promptRefinement";
import type {
  LocalMediaAsset,
  VideoDraft,
  VideoGenerationParams,
} from "@shared/media/videoRequest";
import { DEFAULT_DURATION_SEC, DEFAULT_MOTION_STRENGTH } from "@shared/media/videoRequest";

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
  values?: Readonly<Record<string, string>>;
  createdAt: number;
}

/** 非表示の処理状態。会話本文には出さない。 */
export type OperationState =
  | { status: "idle" }
  | { status: "refining"; requestId: RequestId }
  | { status: "sending"; requestId: RequestId }
  | { status: "success"; requestId: RequestId }
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
    // 値域はモデルごとに異なるため、既定値だけを置き上限は持たない。
    params: {
      durationSec: DEFAULT_DURATION_SEC,
      motionStrength: DEFAULT_MOTION_STRENGTH,
    },
    assets: [],
  },
  draftProduced: false,
  summary: "",
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
  | { type: "send-succeeded"; requestId: RequestId }
  | { type: "send-failed"; requestId: RequestId; message: string }
  | { type: "redo-requested" }
  | { type: "reset-requested" }
  | { type: "copy-succeeded" }
  | { type: "copy-failed" }
  | { type: "copy-cleared" };

/** 進行中の世代と一致する完了かどうか。 */
function isCurrent(
  operation: OperationState,
  status: "refining" | "sending",
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
      if (action.value === undefined) {
        delete params[action.key];
      } else {
        // key と value は呼び出し側で対応付けているため、ここでは代入のみ行う。
        (params as Record<string, unknown>)[action.key] = action.value;
      }
      return { ...state, draft: { ...state.draft, params } };
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
      if (action.result.status === "follow-up") {
        return withTurn(
          {
            ...state,
            followUpIds: {
              questionIds: action.result.questionIds,
              chipIds: action.result.chipIds,
            },
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
          operation: { status: "idle" },
        },
        {
          role: "assistant",
          kind: "draft",
          messageKey: "media.composer.turn.draft",
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
        operation: { status: "sending", requestId: action.requestId },
      };

    // source 未入力などの手前で弾く検証。ready のまま修正・再送信できる。
    case "send-rejected-locally":
      return { ...state, sourceInvalid: true, errorMessage: action.message };

    case "send-succeeded":
      if (!isCurrent(state.operation, "sending", action.requestId)) return state;
      return {
        ...state,
        operation: { status: "success", requestId: action.requestId },
      };

    case "send-failed":
      if (!isCurrent(state.operation, "sending", action.requestId)) return state;
      return {
        ...state,
        errorMessage: action.message,
        operation: {
          status: "error",
          requestId: action.requestId,
          message: action.message,
        },
      };

    case "redo-requested":
      return { ...state, errorMessage: null, operation: { status: "idle" } };

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
