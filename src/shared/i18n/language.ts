/**
 * UI 言語のドメイン (Renderer / Main で共有可能な純ロジック)。
 *
 * 対応: 日本語 / 英語 / 韓国語 / 中国語(簡体・繁体) / フランス語。
 * 中国語は地域から簡体字/繁体字 ("zh-Hans" / "zh-Hant") に分岐する。
 * 追加言語の翻訳は段階導入で、未訳キーは i18n 側で en へフォールバックする。
 */

/** 設定として保存する言語選択。"system" は OS/ブラウザ設定に従う。 */
export type LanguageSetting =
  | "system"
  | "ja"
  | "en"
  | "ko"
  | "zh-Hans"
  | "zh-Hant"
  | "fr";

/** 実際に適用する UI ロケール。 */
export type UiLocale = "ja" | "en" | "ko" | "zh-Hans" | "zh-Hant" | "fr";

export const LANGUAGE_SETTINGS: LanguageSetting[] = [
  "system",
  "ja",
  "en",
  "ko",
  "zh-Hans",
  "zh-Hant",
  "fr",
];

export const SUPPORTED_UI_LOCALES: UiLocale[] = [
  "ja",
  "en",
  "ko",
  "zh-Hans",
  "zh-Hant",
  "fr",
];

/** 繁体字として扱う中国語地域 (それ以外の zh は簡体字)。 */
const ZH_HANT_REGIONS = ["tw", "hk", "mo", "hant"];

/**
 * systemLang (navigator.language 等) を実ロケールへ推定する。
 * 未対応言語は既定の "ja" にフォールバックする。
 */
function detectLocale(systemLang: string): UiLocale {
  const lang = systemLang.toLowerCase();
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("zh")) {
    // "zh-tw" / "zh-hant" 等の地域・表記サブタグで繁体字を判定する。
    const subtags = lang.split("-").slice(1);
    return subtags.some((s) => ZH_HANT_REGIONS.includes(s))
      ? "zh-Hant"
      : "zh-Hans";
  }
  if (lang.startsWith("ja")) return "ja";
  return "ja";
}

/**
 * 言語設定を実ロケールへ解決する。
 * 明示指定はそのまま、"system" は systemLang から推定する。
 */
export function resolveLanguage(
  setting: LanguageSetting,
  systemLang: string,
): UiLocale {
  return setting === "system" ? detectLocale(systemLang) : setting;
}
