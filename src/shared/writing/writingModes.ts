import type { WritingMode } from "@shared/inference/port";

/**
 * 文章作成モードレジストリ (純ロジック)。
 *
 * 5モード (一般/小説/歌詞/仕事の書類/法務文章) の解決・既定値・上限・
 * 入力バリデーション・禁止条件を一元管理する。
 *
 * 方針:
 *  - creative系 (novel/lyrics): temperature を高めに許可 (表現の自由度)。
 *  - formal系 (business/legal): temperature を低く制限 (再現性・正確性重視)。
 */

export interface WritingModeDefaults {
  maxTokens: number;
  temperature: number;
}

export interface WritingModeLimits {
  /** prompt の最大文字数。 */
  maxPromptChars: number;
  /** 許容する temperature の上限 (禁止条件)。 */
  maxTemperature: number;
}

export interface WritingModeDefinition {
  mode: WritingMode;
  /** 日本語ラベル。 */
  label: string;
  defaults: WritingModeDefaults;
  limits: WritingModeLimits;
}

export const WRITING_MODES: Record<WritingMode, WritingModeDefinition> = {
  general: {
    mode: "general",
    label: "一般",
    defaults: { maxTokens: 1024, temperature: 0.7 },
    limits: { maxPromptChars: 8000, maxTemperature: 1.0 },
  },
  novel: {
    mode: "novel",
    label: "小説",
    defaults: { maxTokens: 4096, temperature: 0.9 },
    limits: { maxPromptChars: 20000, maxTemperature: 1.2 },
  },
  lyrics: {
    mode: "lyrics",
    label: "歌詞",
    defaults: { maxTokens: 1024, temperature: 1.0 },
    limits: { maxPromptChars: 4000, maxTemperature: 1.3 },
  },
  business: {
    mode: "business",
    label: "仕事の書類",
    defaults: { maxTokens: 2048, temperature: 0.3 },
    limits: { maxPromptChars: 12000, maxTemperature: 0.6 },
  },
  legal: {
    mode: "legal",
    label: "法務文章",
    defaults: { maxTokens: 3072, temperature: 0.1 },
    limits: { maxPromptChars: 16000, maxTemperature: 0.3 },
  },
};

/** 文字列が既知の WritingMode か。 */
export function isWritingMode(value: string): value is WritingMode {
  return Object.prototype.hasOwnProperty.call(WRITING_MODES, value);
}

/** モード定義を解決する。未知モードは throw。 */
export function resolveWritingMode(mode: string): WritingModeDefinition {
  if (!isWritingMode(mode)) {
    throw new Error(`未知の文章作成モードです: "${mode}"`);
  }
  return WRITING_MODES[mode];
}

export interface WritingRequest {
  mode: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export type WritingViolationCode =
  | "UNSUPPORTED_MODE"
  | "EMPTY_PROMPT"
  | "PROMPT_TOO_LONG"
  | "TEMPERATURE_NOT_ALLOWED"
  | "INVALID_MAX_TOKENS";

export interface WritingViolation {
  code: WritingViolationCode;
  message: string;
}

export interface NormalizedWritingRequest {
  mode: WritingMode;
  prompt: string;
  maxTokens: number;
  temperature: number;
}

export type WritingValidationResult =
  | { ok: true }
  | { ok: false; violations: WritingViolation[] };

/**
 * 入力バリデーション + 禁止条件チェック。
 * 全違反を集約して返す (最初の1件で打ち切らない)。
 */
export function validateWritingRequest(
  req: WritingRequest,
): WritingValidationResult {
  const violations: WritingViolation[] = [];

  if (!isWritingMode(req.mode)) {
    // モード不明時はモード依存の判定ができないため、ここで確定して返す。
    return {
      ok: false,
      violations: [
        {
          code: "UNSUPPORTED_MODE",
          message: `未知の文章作成モードです: "${req.mode}"`,
        },
      ],
    };
  }

  const def = WRITING_MODES[req.mode];

  if (req.prompt.trim().length === 0) {
    violations.push({
      code: "EMPTY_PROMPT",
      message: "プロンプトが空です。",
    });
  }

  if (req.prompt.length > def.limits.maxPromptChars) {
    violations.push({
      code: "PROMPT_TOO_LONG",
      message: `プロンプトが上限 ${def.limits.maxPromptChars} 文字を超えています。`,
    });
  }

  if (req.temperature !== undefined && req.temperature > def.limits.maxTemperature) {
    violations.push({
      code: "TEMPERATURE_NOT_ALLOWED",
      message: `${def.label} モードでは temperature は ${def.limits.maxTemperature} 以下にしてください。`,
    });
  }

  if (req.maxTokens !== undefined && req.maxTokens <= 0) {
    violations.push({
      code: "INVALID_MAX_TOKENS",
      message: "maxTokens は 1 以上にしてください。",
    });
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * モード別既定値で未指定項目を補完する。
 * 事前に validateWritingRequest を通している前提 (モードは既知)。
 */
export function normalizeWritingRequest(
  req: WritingRequest,
): NormalizedWritingRequest {
  const def = resolveWritingMode(req.mode);
  return {
    mode: def.mode,
    prompt: req.prompt,
    maxTokens: req.maxTokens ?? def.defaults.maxTokens,
    temperature: req.temperature ?? def.defaults.temperature,
  };
}
