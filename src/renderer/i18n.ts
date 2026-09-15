import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ja from "@shared/i18n/locales/ja.json";
import en from "@shared/i18n/locales/en.json";
import ko from "@shared/i18n/locales/ko.json";
import zhHans from "@shared/i18n/locales/zh-Hans.json";
import zhHant from "@shared/i18n/locales/zh-Hant.json";
import fr from "@shared/i18n/locales/fr.json";
import { getAikaApi } from "@preload/windowApi";
import { resolveLanguage } from "@shared/i18n/language";

/**
 * Renderer 側 i18n 初期化 (同期・リソース内蔵なのでテストでも即利用可能)。
 * 既定は日本語。未訳キーは en へフォールバックする (追加言語は段階導入)。
 * 翻訳資源は shared に置き、将来 Main からも参照できる形。
 */
void i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
    ko: { translation: ko },
    "zh-Hans": { translation: zhHans },
    "zh-Hant": { translation: zhHant },
    fr: { translation: fr },
  },
  lng: "ja",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** 設定の言語選択を i18n へ反映する。 */
export function applyLanguage(
  setting: Parameters<typeof resolveLanguage>[0],
): Promise<unknown> {
  const systemLang =
    typeof navigator !== "undefined" ? navigator.language : "ja";
  return i18n.changeLanguage(resolveLanguage(setting, systemLang));
}

/** 起動時に設定から言語を読み込んで反映する。 */
export async function initLanguageFromSettings(): Promise<void> {
  const settings = await getAikaApi().getSettings();
  if (settings) await applyLanguage(settings.language);
}

export default i18n;
