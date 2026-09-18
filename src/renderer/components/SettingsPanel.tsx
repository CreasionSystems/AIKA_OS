import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { getAikaApi } from "@preload/windowApi";
import { WRITING_MODES } from "@shared/writing/writingModes";
import type {
  AppSettings,
  LoadSettingsResult,
  SettingsFallback,
  SettingsViolation,
  SettingsReadFailure,
  ThemeSetting,
} from "@shared/settings/settings";
import { LANGUAGE_SETTINGS, type LanguageSetting } from "@shared/i18n/language";
import type { WritingMode } from "@shared/inference/port";
import { applyLanguage } from "../i18n";

/** 設定画面。読込 -> 編集 -> 保存の往復を行う。ラベルは i18n。 */
type Phase = "loading" | "ready" | "saving" | "saved" | "error";

const THEME_OPTIONS: ThemeSetting[] = ["light", "dark", "system"];
const MODE_OPTIONS = Object.values(WRITING_MODES);

/** 想定外の失敗に使う表示用の意味 ID。内部情報は一切出さない。 */
const GENERIC_ERROR_KEY = "settings.error.saveFailed";

/** 読み取り失敗の理由ごとの説明文。内部情報は出さない。 */
const FAILURE_KEY: Record<SettingsReadFailure, string> = {
  permission: "settings.load.unavailable.permission",
  "not-a-file": "settings.load.unavailable.notAFile",
  malformed: "settings.load.unavailable.malformed",
  io: "settings.load.unavailable.io",
};

/** 設定項目のラベル。フォールバック明細の本文を組み立てるのに使う。 */
const ITEM_LABEL_KEY: Record<keyof AppSettings, string> = {
  defaultWritingMode: "settings.writingMode.label",
  theme: "settings.theme.label",
  jobHistoryLimit: "settings.jobHistoryLimit.label",
  mediaPollIntervalMs: "settings.pollInterval.label",
  language: "settings.language.label",
};

export function SettingsPanel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  /**
   * 読み込みの結果。保存の状態機械 (Phase) とは発生源も消える条件も違うため
   * 混ぜない (validationIssues と diagnostics を分けたのと同じ理由)。
   */
  const [load, setLoad] = useState<LoadSettingsResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void getAikaApi()
      .getSettings()
      .then((res) => {
        if (!active) return;
        setLoad(res);
        if (res.status !== "unavailable") {
          setSettings(res.settings);
          setPhase("ready");
        }
      })
      .catch(() => {
        // IPC 自体の失敗。画面を空白のまま固めない。
        if (active) setLoad({ status: "unavailable", failure: "io" });
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  /** live region 用の短い状態サマリー。 */
  function summarize(): string {
    if (phase === "saving") return t("settings.status.saving");
    if (phase === "saved") return t("settings.status.saved");
    return t("settings.status.unsaved");
  }

  /** 読み取れない設定の上にフォームを出さない。上書きを誘発するため。 */
  if (load !== null && load.status === "unavailable") {
    return (
      <section>
        <h1>{t("settings.title")}</h1>
        {/* 短い要約のみ live region。入力エラーでも処理失敗でもないため
            role="alert" にはしない。 */}
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={t("settings.load.status.label")}
        >
          {t("settings.load.status.unavailable")}
        </p>
        <p>{t(FAILURE_KEY[load.failure])}</p>
        <button type="button" onClick={() => setReloadKey((n) => n + 1)}>
          {t("settings.load.retry")}
        </button>
      </section>
    );
  }

  if (settings === null) {
    return <p>{t("settings.status.unsaved")}</p>;
  }

  function patch(update: Partial<AppSettings>) {
    setSettings((prev) => (prev === null ? prev : { ...prev, ...update }));
    setPhase("ready");
  }

  function onLanguageChange(value: LanguageSetting) {
    patch({ language: value });
    // 即時に UI へ反映する (保存前でも切替確認できる)。
    void applyLanguage(value);
  }

  /**
   * 違反明細を表示文言にする。ロケール文字列は明細に含まれず、ここで決まる。
   * モード名と許容値一覧は補間前に翻訳する (明細はコードだけを運ぶ)。
   */
  function issueText(issue: SettingsViolation): string {
    const params: Record<string, string | number> = {
      ...(issue.messageParams ?? {}),
    };
    if (typeof params.mode === "string") {
      params.mode = t(`writing.mode.option.${params.mode}`);
    }
    if (typeof params.allowed === "string") {
      const prefix =
        issue.code === "INVALID_THEME"
          ? "settings.theme.option"
          : "settings.language.option";
      params.allowed = params.allowed
        .split(",")
        .map((v) => t(`${prefix}.${v}`))
        .join(" / ");
    }
    return t(issue.messageKey, params);
  }

  /** 既定値へ落とされた項目 (読めたが値が壊れていたもの)。 */
  const recovered: readonly SettingsFallback[] =
    load !== null && load.status === "recovered" ? load.issues : [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (settings === null) return;
    setPhase("saving");
    setError(null);
    try {
      // 既定値で開いている間の保存は、元の値を上書きする意思の表明を伴う。
      // 判定は main が読み直して行う。ここでの申告は補助にすぎない。
      const res = await getAikaApi().saveSettings(
        settings,
        recovered.length > 0 ? "restore-defaults" : "normal",
      );
      if (res.status === "succeeded") {
        setSettings(res.result);
        setPhase("saved");
        // 書き込めた時点で永続値は健全になったので、復旧の提示を下げる。
        setLoad({ status: "ready", settings: res.result });
        return;
      }
      if (res.status === "invalid") {
        // 入力は保持したまま明細を出す。フォームは残るので直して再保存できる。
        setError(res.issues.map(issueText).join(" / "));
        setPhase("error");
        return;
      }
      setError(t(res.messageKey, res.messageParams ?? {}));
      setPhase("error");
    } catch {
      // IPC 自体の失敗 (プロセス断など) は依然 reject しうる。
      // 生の err.message は channel 名を含むため表示しない。
      setError(t(GENERIC_ERROR_KEY));
      setPhase("error");
    }
  }

  return (
    <section>
      <h1>{t("settings.title")}</h1>

      {/* 読み込み状態の短い要約。初回レンダリングから存在させ、送信状態とは
          aria-label で一意化する。入力エラーではないので alert にしない。 */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("settings.load.status.label")}
      >
        {recovered.length > 0 ? t("settings.load.status.recovered") : ""}
      </p>

      {/* 既定値へ落とした項目の明細。説明的な本文のため live region の外。 */}
      {recovered.length > 0 && (
        <section aria-label={t("settings.load.recovered.title")}>
          <h2>{t("settings.load.recovered.title")}</h2>
          <ul>
            {recovered.map((f) => (
              <li key={f.key}>
                {t("settings.load.fallback.invalid", {
                  item: t(ITEM_LABEL_KEY[f.key]),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={onSubmit}>
        <label htmlFor="settings-language">{t("settings.language.label")}</label>
        <select
          id="settings-language"
          value={settings.language}
          onChange={(e) => onLanguageChange(e.target.value as LanguageSetting)}
        >
          {LANGUAGE_SETTINGS.map((l) => (
            <option key={l} value={l}>
              {t(`settings.language.option.${l}`)}
            </option>
          ))}
        </select>

        <label htmlFor="settings-theme">{t("settings.theme.label")}</label>
        <select
          id="settings-theme"
          value={settings.theme}
          onChange={(e) => patch({ theme: e.target.value as ThemeSetting })}
        >
          {THEME_OPTIONS.map((th) => (
            <option key={th} value={th}>
              {t(`settings.theme.option.${th}`)}
            </option>
          ))}
        </select>

        <label htmlFor="settings-mode">{t("settings.writingMode.label")}</label>
        <select
          id="settings-mode"
          value={settings.defaultWritingMode}
          onChange={(e) =>
            patch({ defaultWritingMode: e.target.value as WritingMode })
          }
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m.mode} value={m.mode}>
              {t(`writing.mode.option.${m.mode}`)}
            </option>
          ))}
        </select>

        <label htmlFor="settings-job-limit">
          {t("settings.jobHistoryLimit.label")}
        </label>
        <input
          id="settings-job-limit"
          type="number"
          value={settings.jobHistoryLimit}
          onChange={(e) => patch({ jobHistoryLimit: e.target.valueAsNumber })}
        />

        <label htmlFor="settings-poll-interval">
          {t("settings.pollInterval.label")}
        </label>
        <input
          id="settings-poll-interval"
          type="number"
          value={settings.mediaPollIntervalMs}
          onChange={(e) =>
            patch({ mediaPollIntervalMs: e.target.valueAsNumber })
          }
        />

        {/* 既定値で開いている間は、保存が既存内容を置き換えることを
            ラベルで明示する (ADR-001 D8: 補正は承認可能な形で示す)。 */}
        <button type="submit" disabled={phase === "saving"}>
          {recovered.length > 0
            ? t("settings.load.recovered.applyDefaults")
            : t("settings.action.save")}
        </button>
      </form>

      {/* 短い状態サマリーのみ live region に置く。読み込み状態の region と
          混ざらないよう aria-label で一意化する。 */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("settings.status.label")}
      >
        {summarize()}
      </p>

      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
