import { describe, it, expect } from "vitest";
import ja from "./locales/ja.json";
import en from "./locales/en.json";
import ko from "./locales/ko.json";
import zhHans from "./locales/zh-Hans.json";
import zhHant from "./locales/zh-Hant.json";
import fr from "./locales/fr.json";
import { SUPPORTED_UI_LOCALES } from "./language";

/**
 * ロケール資源の構造テスト。
 *
 * - 主要画面キー (nav / settings / media の運用文言) は全ロケールで実訳必須。
 * - 追加言語 (ko/zh/fr) は「一部実訳 + en フォールバック」方針のため、
 *   未訳キー (media.kind.option.* の動画種別など) は en へ委ねる。
 * - 言語選択肢はどのロケールでも 7 種すべてを持つ (ネイティブ表記)。
 */
type Json = Record<string, unknown>;

function flatten(obj: Json, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix === "" ? k : `${prefix}.${k}`;
    return typeof v === "object" && v !== null
      ? flatten(v as Json, key)
      : [key];
  });
}

function get(obj: Json, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === "object"
          ? (acc as Json)[k]
          : undefined,
      obj,
    );
}

const LOCALES: Record<string, Json> = {
  ja,
  en,
  ko,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  fr,
};

/** 全ロケールで実訳必須の主要画面キー。 */
const REQUIRED_KEYS = [
  "nav.label",
  "nav.tab.writing",
  "nav.tab.settings",
  "nav.tab.update",
  "nav.tab.coding",
  "nav.tab.media",
  "settings.title",
  "settings.theme.label",
  "settings.writingMode.label",
  "settings.jobHistoryLimit.label",
  "settings.pollInterval.label",
  "settings.language.label",
  "settings.action.save",
  "settings.status.unsaved",
  "settings.status.saving",
  "settings.status.saved",
  "media.title",
  "media.kind.label",
  "media.kind.option.image",
  "media.kind.option.t2v",
  "media.kind.option.i2v",
  "media.kind.option.continuation",
  "media.kind.option.edit",
  "media.kind.option.audio",
  "media.prompt.label",
  "media.source.label",
  "media.action.submitImage",
  "media.action.submitVideo",
  "media.action.submitting",
  "media.action.refresh",
  "media.status.idle",
  "media.status.succeeded",
  "media.status.failed",
  "media.error.sourceRequired",
  "media.history.title",
  "media.history.clear",
  "media.composer.instruction.label",
  "media.composer.instruction.placeholder",
  "media.composer.action.compose",
  "media.composer.action.continue",
  "media.composer.action.send",
  "media.composer.action.retry",
  "media.composer.action.redo",
  "media.composer.action.reset",
  "media.composer.hint.enterToSend",
  "media.composer.followup.title",
  "media.composer.chips.title",
  "media.composer.summary.title",
  "media.composer.finalPrompt.label",
  "media.composer.status.idle",
  "media.composer.status.validating",
  "media.composer.status.followup",
  "media.composer.status.ready",
  "media.composer.status.sending",
  "media.composer.status.success",
  "media.composer.status.error",
  "media.composer.question.subject",
  "media.composer.question.motion",
  "media.composer.question.style",
  "media.composer.chip.cinematic",
  "media.composer.chip.anime",
  "media.composer.chip.slowMotion",
  "media.composer.chip.aerial",
  "writing.title",
  "writing.mode.label",
  "writing.mode.option.general",
  "writing.mode.option.novel",
  "writing.mode.option.lyrics",
  "writing.mode.option.business",
  "writing.mode.option.legal",
  "writing.prompt.label",
  "writing.action.generate",
  "writing.status.idle",
  "writing.status.generated",
  "writing.result.label",
  "update.title",
  "update.action.check",
  "update.status.idle",
  "update.status.checking",
  "update.status.upToDate",
  "update.status.available",
  "update.status.error",
  "coding.title",
  "coding.goal.label",
  "coding.action.plan",
  "coding.action.execute",
  "coding.action.verify",
  "coding.action.rewind",
  "coding.status.idle",
  "coding.status.planned_other",
  "coding.status.executed",
  "coding.status.verified",
  "coding.status.rewound",
  "coding.plan.label",
  "coding.executionLog.label",
  "coding.verification.label",
  "coding.verification.passed",
  "coding.verification.failed",
];

const LANGUAGE_OPTION_KEYS = SUPPORTED_UI_LOCALES.map(
  (l) => `settings.language.option.${l}`,
).concat("settings.language.option.system");

/** i18next の plural サフィックスを除いた論理キーへ正規化する。 */
function stripPlural(key: string): string {
  return key.replace(/_(zero|one|two|few|many|other)$/, "");
}

describe("ロケール資源の完全性", () => {
  it("ja と en は同じ論理キー集合を持つ基準ロケール", () => {
    // plural サフィックス (_one/_other 等) は言語ごとに異なるため正規化して比較。
    const jaKeys = [...new Set(flatten(ja).map(stripPlural))].sort();
    const enKeys = [...new Set(flatten(en).map(stripPlural))].sort();
    expect(enKeys).toEqual(jaKeys);
  });

  for (const [name, dict] of Object.entries(LOCALES)) {
    it(`${name}: 主要画面キーを実訳で持つ`, () => {
      for (const key of REQUIRED_KEYS) {
        const v = get(dict, key);
        expect(v, `${name}.${key}`).toBeTypeOf("string");
        expect((v as string).length, `${name}.${key}`).toBeGreaterThan(0);
      }
    });

    it(`${name}: 言語選択肢 7 種をネイティブ表記で持つ`, () => {
      for (const key of LANGUAGE_OPTION_KEYS) {
        expect(get(dict, key), `${name}.${key}`).toBeTypeOf("string");
      }
    });
  }

  it("全ロケールが動画種別ラベル (media.kind.option) を実訳で持つ", () => {
    // Step 39 で 4 追加言語も実訳し、en フォールバックへの依存を解消した。
    const kinds = ["image", "t2v", "i2v", "continuation", "edit", "audio"];
    for (const name of Object.keys(LOCALES)) {
      for (const k of kinds) {
        const v = get(LOCALES[name] as Json, `media.kind.option.${k}`);
        expect(v, `${name}.media.kind.option.${k}`).toBeTypeOf("string");
        expect(
          (v as string).length,
          `${name}.media.kind.option.${k}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
