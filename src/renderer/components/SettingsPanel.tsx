import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { getAikaApi } from "@preload/windowApi";
import { WRITING_MODES } from "@shared/writing/writingModes";
import type {
  AppSettings,
  SettingsViolation,
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

export function SettingsPanel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAikaApi()
      .getSettings()
      .then((s) => {
        if (active) {
          setSettings(s);
          setPhase("ready");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  /** live region 用の短い状態サマリー。 */
  function summarize(): string {
    if (phase === "saving") return t("settings.status.saving");
    if (phase === "saved") return t("settings.status.saved");
    return t("settings.status.unsaved");
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (settings === null) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await getAikaApi().saveSettings(settings);
      if (res.status === "succeeded") {
        setSettings(res.result);
        setPhase("saved");
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

        <button type="submit" disabled={phase === "saving"}>
          {t("settings.action.save")}
        </button>
      </form>

      {/* 短い状態サマリーのみ live region に置く。 */}
      <p role="status" aria-live="polite" aria-atomic="true">
        {summarize()}
      </p>

      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
