import { describe, it, expect } from "vitest";
import {
  resolveLanguage,
  LANGUAGE_SETTINGS,
  SUPPORTED_UI_LOCALES,
  type LanguageSetting,
  type UiLocale,
} from "./language";

/**
 * UI 言語ドメインの契約テスト (純ロジック)。
 * 設定 -> 実ロケール解決と、対応ロケール一覧を固定する。
 */
describe("LANGUAGE_SETTINGS / SUPPORTED_UI_LOCALES", () => {
  it("設定は system + 6 ロケール", () => {
    expect(LANGUAGE_SETTINGS).toEqual([
      "system",
      "ja",
      "en",
      "ko",
      "zh-Hans",
      "zh-Hant",
      "fr",
    ]);
  });

  it("実ロケールは system を除く 6 種", () => {
    expect(SUPPORTED_UI_LOCALES).toEqual([
      "ja",
      "en",
      "ko",
      "zh-Hans",
      "zh-Hant",
      "fr",
    ]);
  });
});

describe("resolveLanguage: 明示指定はそのまま返す", () => {
  const explicit: [LanguageSetting, UiLocale][] = [
    ["ja", "ja"],
    ["en", "en"],
    ["ko", "ko"],
    ["zh-Hans", "zh-Hans"],
    ["zh-Hant", "zh-Hant"],
    ["fr", "fr"],
  ];
  for (const [setting, locale] of explicit) {
    it(`${setting} -> ${locale} (systemLang を無視)`, () => {
      expect(resolveLanguage(setting, "en-US")).toBe(locale);
    });
  }
});

describe("resolveLanguage: system は systemLang から推定", () => {
  const cases: [string, UiLocale][] = [
    ["ja-JP", "ja"],
    ["en-US", "en"],
    ["en", "en"],
    ["ko-KR", "ko"],
    ["ko", "ko"],
    ["fr-FR", "fr"],
    ["fr-CA", "fr"],
    // 中国語は簡体/繁体を地域から分岐する。
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh-Hans", "zh-Hans"],
    ["zh", "zh-Hans"],
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-MO", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    // 大文字小文字は無視する。
    ["ZH-TW", "zh-Hant"],
    ["FR-fr", "fr"],
  ];
  for (const [sys, locale] of cases) {
    it(`${sys} -> ${locale}`, () => {
      expect(resolveLanguage("system", sys)).toBe(locale);
    });
  }

  it("未対応言語は既定の ja へフォールバックする", () => {
    expect(resolveLanguage("system", "de-DE")).toBe("ja");
    expect(resolveLanguage("system", "")).toBe("ja");
  });
});
