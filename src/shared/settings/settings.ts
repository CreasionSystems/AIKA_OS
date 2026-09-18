import type { WritingMode } from "@shared/inference/port";
import { isWritingMode } from "@shared/writing/writingModes";
import { LANGUAGE_SETTINGS, type LanguageSetting } from "@shared/i18n/language";

/**
 * アプリ一般設定のドメイン + 永続化抽象。
 *
 * 注意 (機密分離): API キー等の機密情報はこの一般設定ストアに混ぜない。
 * 必要になった時点で OS のセキュアストレージ等、別経路 (SecretStore) に
 * 分離する。AppSettings には機密項目を持たせないこと。
 */

export type ThemeSetting = "light" | "dark" | "system";

export interface AppSettings {
  defaultWritingMode: WritingMode;
  theme: ThemeSetting;
  /** 保持するジョブ履歴の最大件数 (正の整数)。 */
  jobHistoryLimit: number;
  /** メディアジョブ監視の自動ポーリング周期 (ms, 整数 100〜60000)。 */
  mediaPollIntervalMs: number;
  /** UI 表示言語。将来 ko / zh-Hans / fr を追加予定。 */
  language: LanguageSetting;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultWritingMode: "general",
  theme: "system",
  jobHistoryLimit: 50,
  mediaPollIntervalMs: 1000,
  language: "system",
};

const THEMES: ThemeSetting[] = ["light", "dark", "system"];

/** mediaPollIntervalMs の許容範囲 (ms)。 */
const POLL_INTERVAL_MIN = 100;
const POLL_INTERVAL_MAX = 60_000;

export type SettingsViolationCode =
  | "INVALID_WRITING_MODE"
  | "INVALID_THEME"
  | "INVALID_JOB_HISTORY_LIMIT"
  | "INVALID_POLL_INTERVAL"
  | "INVALID_LANGUAGE";

/**
 * 検証違反の明細。
 *
 * 表示文言ではなく i18n キーと補間値で持つ。IPC を越えて renderer へ運ばれ、
 * 表示は renderer が t() で決める。shared / service / IPC はロケール文字列を
 * 持たない (6ロケール実訳の原則)。writing 側と同じ形に揃えてある。
 */
export interface SettingsViolation {
  code: SettingsViolationCode;
  messageKey: string;
  messageParams?: Readonly<Record<string, string | number>>;
}

export type SettingsValidationResult =
  | { ok: true }
  | { ok: false; violations: SettingsViolation[] };

/** 項目単位の妥当性判定 (load のフォールバックと共用)。 */
function isValidWritingMode(v: unknown): v is WritingMode {
  return typeof v === "string" && isWritingMode(v);
}
function isValidTheme(v: unknown): v is ThemeSetting {
  return typeof v === "string" && THEMES.includes(v as ThemeSetting);
}
function isValidJobHistoryLimit(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}
function isValidPollIntervalMs(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= POLL_INTERVAL_MIN &&
    v <= POLL_INTERVAL_MAX
  );
}
function isValidLanguage(v: unknown): v is LanguageSetting {
  return typeof v === "string" && LANGUAGE_SETTINGS.includes(v as LanguageSetting);
}

/** 与えられた部分設定を検証する。present かつ不正な項目のみ違反にする。 */
export function validateSettings(
  patch: Partial<Record<keyof AppSettings, unknown>>,
): SettingsValidationResult {
  const violations: SettingsViolation[] = [];

  if (
    patch.defaultWritingMode !== undefined &&
    !isValidWritingMode(patch.defaultWritingMode)
  ) {
    violations.push({
      code: "INVALID_WRITING_MODE",
      messageKey: "settings.validation.invalidWritingMode",
      // 表示名への変換は renderer が writing.mode.option.* で行う。
      messageParams: { mode: String(patch.defaultWritingMode) },
    });
  }
  if (patch.theme !== undefined && !isValidTheme(patch.theme)) {
    violations.push({
      code: "INVALID_THEME",
      messageKey: "settings.validation.invalidTheme",
      // 許容値はコードのまま運ぶ。renderer が選択肢ラベルへ翻訳して並べる。
      messageParams: { allowed: THEMES.join(",") },
    });
  }
  if (
    patch.jobHistoryLimit !== undefined &&
    !isValidJobHistoryLimit(patch.jobHistoryLimit)
  ) {
    violations.push({
      code: "INVALID_JOB_HISTORY_LIMIT",
      messageKey: "settings.validation.invalidJobHistoryLimit",
    });
  }
  if (
    patch.mediaPollIntervalMs !== undefined &&
    !isValidPollIntervalMs(patch.mediaPollIntervalMs)
  ) {
    violations.push({
      code: "INVALID_POLL_INTERVAL",
      messageKey: "settings.validation.invalidPollInterval",
      messageParams: { min: POLL_INTERVAL_MIN, max: POLL_INTERVAL_MAX },
    });
  }
  if (patch.language !== undefined && !isValidLanguage(patch.language)) {
    violations.push({
      code: "INVALID_LANGUAGE",
      messageKey: "settings.validation.invalidLanguage",
      messageParams: { allowed: LANGUAGE_SETTINGS.join(",") },
    });
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

export class SettingsValidationError extends Error {
  readonly violations: SettingsViolation[];
  constructor(violations: SettingsViolation[]) {
    super(
      `設定が不正です: ${violations.map((v) => v.code).join(", ")}`,
    );
    this.name = "SettingsValidationError";
    this.violations = violations;
  }
}

/**
 * 永続化の差し替え境界。
 * Fake (メモリ) / File (JSON) など実装を差し替え可能にする。
 */
export interface SettingsStore {
  read(): Promise<Record<string, unknown> | null>;
  write(settings: AppSettings): Promise<void>;
}

/** 永続値を既定にマージする。不正な項目は既定へフォールバックする。 */
function mergeWithDefaults(
  raw: Record<string, unknown> | null,
): AppSettings {
  const r = raw ?? {};
  return {
    defaultWritingMode: isValidWritingMode(r.defaultWritingMode)
      ? r.defaultWritingMode
      : DEFAULT_SETTINGS.defaultWritingMode,
    theme: isValidTheme(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    jobHistoryLimit: isValidJobHistoryLimit(r.jobHistoryLimit)
      ? r.jobHistoryLimit
      : DEFAULT_SETTINGS.jobHistoryLimit,
    mediaPollIntervalMs: isValidPollIntervalMs(r.mediaPollIntervalMs)
      ? r.mediaPollIntervalMs
      : DEFAULT_SETTINGS.mediaPollIntervalMs,
    language: isValidLanguage(r.language)
      ? r.language
      : DEFAULT_SETTINGS.language,
  };
}

export class SettingsService {
  constructor(private readonly store: SettingsStore) {}

  /** 永続値を既定にマージして返す (不正項目は既定へフォールバック)。 */
  async load(): Promise<AppSettings> {
    return mergeWithDefaults(await this.store.read());
  }

  /**
   * 部分更新を検証 -> 現在値へマージ -> 書込。
   * 不正値は SettingsValidationError を投げ、書込まない。
   */
  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const validation = validateSettings(patch);
    if (!validation.ok) {
      throw new SettingsValidationError(validation.violations);
    }
    const current = await this.load();
    const next: AppSettings = { ...current, ...patch };
    await this.store.write(next);
    return next;
  }
}
