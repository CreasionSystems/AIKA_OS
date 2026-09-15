import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ja from "@shared/i18n/locales/ja.json";
import en from "@shared/i18n/locales/en.json";
import { getAikaApi } from "@preload/windowApi";
import { resolveLanguage } from "@shared/i18n/language";

/**
 * Renderer 側 i18n 初期化 (同期・リソース内蔵なのでテストでも即利用可能)。
 * 既定は日本語。翻訳資源は shared に置き、将来 Main からも参照できる形。
 */
void i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: "ja",
  fallbackLng: "ja",
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
