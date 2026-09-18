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

/** 設定を読み取れない理由。表示文言は renderer が決める。 */
export type SettingsReadFailure =
  | "permission" // EACCES / EPERM
  | "not-a-file" // EISDIR
  | "malformed" // JSON 構文破損 / 空 / object でない
  | "io"; // その他

/**
 * 永続層の読み取り結果。
 *
 * 「ファイルが無い (初回起動)」と「読めない」を呼び出し側が区別できるように、
 * 例外ではなく値で返す。両者は意味も対処も違うのに、以前はどちらも
 * 「既定値の AppSettings」に潰れていた。
 */
export type SettingsReadResult =
  | { status: "missing" }
  | { status: "loaded"; raw: Record<string, unknown> }
  | { status: "unreadable"; failure: SettingsReadFailure };

/**
 * 永続化の差し替え境界。
 * Fake (メモリ) / File (JSON) など実装を差し替え可能にする。
 */
export interface SettingsStore {
  read(): Promise<SettingsReadResult>;
  write(settings: AppSettings): Promise<void>;
}

/**
 * 既定値へ落とした項目。
 *
 * reason が両者を分ける:
 * - "missing" … キーが無い。将来の項目追加で必ず起きる前方互換。正常
 * - "invalid" … 値が壊れている。利用者に知らせるべき異常
 *
 * 表示文言は項目ラベルと組み合わせて renderer が決めるため、ここでは持たない。
 */
export interface SettingsFallback {
  key: keyof AppSettings;
  reason: "missing" | "invalid";
}

/**
 * 設定読み込みの結果。
 *
 * - ready       … 正常。初回起動と互換キー補完もここに含む (通知不要)
 * - recovered   … 読めたが値が壊れており、既定値で開いた。利用者に示す
 * - unavailable … そもそも読めなかった。設定を返さない
 *
 * plain data のみで構成し、IPC の structured clone を安全に通す。
 */
export type LoadSettingsResult =
  | { status: "ready"; settings: AppSettings }
  | {
      status: "recovered";
      settings: AppSettings;
      issues: readonly SettingsFallback[];
    }
  | { status: "unavailable"; failure: SettingsReadFailure };

/** 検証関数と対象キーの対応。merge と validate で同じ判定を使う。 */
const FIELD_VALIDATORS: {
  [K in keyof AppSettings]: (v: unknown) => v is AppSettings[K];
} = {
  defaultWritingMode: isValidWritingMode,
  theme: isValidTheme,
  jobHistoryLimit: isValidJobHistoryLimit,
  mediaPollIntervalMs: isValidPollIntervalMs,
  language: isValidLanguage,
};

const SETTINGS_KEYS = Object.keys(FIELD_VALIDATORS) as (keyof AppSettings)[];

/**
 * 永続値を既定にマージし、既定値へ落とした項目を報告する。
 *
 * 「何を捨てたか」を知っているのはこの関数だけなので、AppSettings だけを
 * 返すと呼び出し側が正常と異常を区別できない。
 */
export function mergeWithDefaults(raw: Record<string, unknown>): {
  settings: AppSettings;
  fallbacks: readonly SettingsFallback[];
} {
  const settings = { ...DEFAULT_SETTINGS };
  const fallbacks: SettingsFallback[] = [];

  for (const key of SETTINGS_KEYS) {
    const value = raw[key];
    if (FIELD_VALIDATORS[key](value)) {
      // key と value は同じ FIELD_VALIDATORS で対応付けている。
      (settings as Record<string, unknown>)[key] = value;
      continue;
    }
    fallbacks.push({
      key,
      reason: value === undefined ? "missing" : "invalid",
    });
  }

  return { settings, fallbacks };
}

/** 読み取れなかったことを表す内部エラー。IPC 境界で failed へ変換される。 */
export class SettingsUnavailableError extends Error {
  readonly failure: SettingsReadFailure;
  constructor(failure: SettingsReadFailure) {
    super(`設定を読み取れません: ${failure}`);
    this.name = "SettingsUnavailableError";
    this.failure = failure;
  }
}

/**
 * 保存の意図。
 *
 * 既定値へ落ちた設定を保存すると、壊れていた元の値は失われる。その上書きを
 * 意図した保存だけを "restore-defaults" として区別する。曖昧な boolean では
 * なく意味のある名前にして、呼び出し側で取り違えないようにする。
 */
export type SaveSettingsIntent = "normal" | "restore-defaults";

/**
 * 既定値での上書きになるため、明示的な復旧の意思が要ることを表す内部エラー。
 * IPC 境界で failed へ変換される。
 */
export class SettingsRecoveryRequiredError extends Error {
  readonly issues: readonly SettingsFallback[];
  constructor(issues: readonly SettingsFallback[]) {
    super(
      `既定値での上書きになるため復旧の明示が必要です: ${issues
        .map((i) => i.key)
        .join(", ")}`,
    );
    this.name = "SettingsRecoveryRequiredError";
    this.issues = issues;
  }
}

export class SettingsService {
  constructor(private readonly store: SettingsStore) {}

  /**
   * 永続値を読み、正常 / 既定値復旧 / 読取不能を区別して返す。
   * 例外は投げない (呼び出し側が起動を止めないようにするため)。
   */
  async load(): Promise<LoadSettingsResult> {
    const read = await this.store.read();
    if (read.status === "unreadable") {
      return { status: "unavailable", failure: read.failure };
    }
    const { settings, fallbacks } = mergeWithDefaults(
      read.status === "loaded" ? read.raw : {},
    );
    // 欠落キーの補完は前方互換であって異常ではない。値の不正だけを報告する。
    const issues = fallbacks.filter((f) => f.reason === "invalid");
    return issues.length === 0
      ? { status: "ready", settings }
      : { status: "recovered", settings, issues };
  }

  /**
   * 部分更新を検証 -> 現在値へマージ -> 書込。
   * 不正値は SettingsValidationError を投げ、書込まない。
   *
   * 読み取れない設定の上には書かない。読めていない内容を既定値で
   * 上書きしてしまうため、SettingsUnavailableError を投げて中断する。
   *
   * 値が壊れていて既定値で開いている場合も、そのまま書くと元の値が失われる。
   * 復旧の意思が明示されていなければ SettingsRecoveryRequiredError で中断する。
   *
   * 状態は必ずここで読み直して判定する。renderer の自己申告は信用しない。
   */
  async save(
    patch: Partial<AppSettings>,
    intent: SaveSettingsIntent = "normal",
  ): Promise<AppSettings> {
    const validation = validateSettings(patch);
    if (!validation.ok) {
      throw new SettingsValidationError(validation.violations);
    }
    const loaded = await this.load();
    if (loaded.status === "unavailable") {
      throw new SettingsUnavailableError(loaded.failure);
    }
    if (loaded.status === "recovered" && intent !== "restore-defaults") {
      throw new SettingsRecoveryRequiredError(loaded.issues);
    }
    const next: AppSettings = { ...loaded.settings, ...patch };
    await this.store.write(next);
    return next;
  }
}
