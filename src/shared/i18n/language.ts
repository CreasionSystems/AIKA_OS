/**
 * UI 言語のドメイン (Renderer / Main で共有可能な純ロジック)。
 *
 * 今回は日本語 / 英語のみ。将来 "ko" / "zh-Hans" / "fr" を追加予定。
 * 中国語は簡体字/繁体字で "zh-Hans" / "zh-Hant" に分岐する想定
 * (LanguageSetting・UiLocale ともに union を広げるだけで対応できる形)。
 */

/** 設定として保存する言語選択。"system" は OS/ブラウザ設定に従う。 */
export type LanguageSetting = "system" | "ja" | "en";

/** 実際に適用する UI ロケール。 */
export type UiLocale = "ja" | "en";

export const LANGUAGE_SETTINGS: LanguageSetting[] = ["system", "ja", "en"];
export const SUPPORTED_UI_LOCALES: UiLocale[] = ["ja", "en"];

/**
 * 言語設定を実ロケールへ解決する。
 * "system" は systemLang (navigator.language 等) から推定し、
 * 未対応言語は既定の "ja" にフォールバックする。
 */
export function resolveLanguage(
  setting: LanguageSetting,
  systemLang: string,
): UiLocale {
  if (setting === "ja" || setting === "en") return setting;
  return systemLang.toLowerCase().startsWith("en") ? "en" : "ja";
}
