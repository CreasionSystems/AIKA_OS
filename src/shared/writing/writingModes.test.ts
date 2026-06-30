import { describe, it, expect } from "vitest";
import {
  WRITING_MODES,
  resolveWritingMode,
  isWritingMode,
  validateWritingRequest,
  normalizeWritingRequest,
} from "./writingModes";
import type { WritingMode } from "@shared/inference/port";

/**
 * 文章作成モードレジストリの契約テスト (純ロジック)。
 *
 * 固定する契約:
 *  - 5モード (一般/小説/歌詞/仕事の書類/法務文章) の解決
 *  - 入力バリデーション (空・長さ・maxTokens)
 *  - モード別既定値 (maxTokens / temperature)
 *  - 禁止条件 (formal系の temperature 上限など)
 */

const ALL_MODES: WritingMode[] = [
  "general",
  "novel",
  "lyrics",
  "business",
  "legal",
];

describe("resolveWritingMode / isWritingMode", () => {
  it("5モードすべてを定義し、日本語ラベルを持つ", () => {
    for (const m of ALL_MODES) {
      const def = resolveWritingMode(m);
      expect(def.mode).toBe(m);
      expect(def.label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(WRITING_MODES).sort()).toEqual([...ALL_MODES].sort());
  });

  it("未知モードは throw する", () => {
    expect(() => resolveWritingMode("haiku")).toThrow(/haiku/);
  });

  it("型ガード isWritingMode", () => {
    expect(isWritingMode("novel")).toBe(true);
    expect(isWritingMode("unknown")).toBe(false);
  });
});

describe("モード別既定値", () => {
  it("formal系 (business/legal) は creative系 (novel/lyrics) より temperature 既定が低い", () => {
    const legal = resolveWritingMode("legal").defaults.temperature;
    const business = resolveWritingMode("business").defaults.temperature;
    const novel = resolveWritingMode("novel").defaults.temperature;
    const lyrics = resolveWritingMode("lyrics").defaults.temperature;
    expect(legal).toBeLessThan(novel);
    expect(business).toBeLessThan(lyrics);
  });

  it("各モードは正の maxTokens 既定と maxPromptChars 上限を持つ", () => {
    for (const m of ALL_MODES) {
      const def = resolveWritingMode(m);
      expect(def.defaults.maxTokens).toBeGreaterThan(0);
      expect(def.limits.maxPromptChars).toBeGreaterThan(0);
    }
  });
});

describe("validateWritingRequest", () => {
  it("正常な一般リクエストを受理する", () => {
    const r = validateWritingRequest({ mode: "general", prompt: "こんにちは" });
    expect(r.ok).toBe(true);
  });

  it("空/空白のみのプロンプトを禁止 (EMPTY_PROMPT)", () => {
    const r = validateWritingRequest({ mode: "general", prompt: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain("EMPTY_PROMPT");
    }
  });

  it("モード上限を超える長さを禁止 (PROMPT_TOO_LONG)", () => {
    const max = resolveWritingMode("lyrics").limits.maxPromptChars;
    const r = validateWritingRequest({
      mode: "lyrics",
      prompt: "a".repeat(max + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain("PROMPT_TOO_LONG");
    }
  });

  it("禁止条件: legal は高い temperature を拒否 (TEMPERATURE_NOT_ALLOWED)", () => {
    const r = validateWritingRequest({
      mode: "legal",
      prompt: "契約書を作成",
      temperature: 0.9,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain(
        "TEMPERATURE_NOT_ALLOWED",
      );
    }
  });

  it("creative系 novel は高い temperature を許可する", () => {
    const r = validateWritingRequest({
      mode: "novel",
      prompt: "物語を書く",
      temperature: 1.1,
    });
    expect(r.ok).toBe(true);
  });

  it("不正な maxTokens (<=0) を禁止 (INVALID_MAX_TOKENS)", () => {
    const r = validateWritingRequest({
      mode: "general",
      prompt: "x",
      maxTokens: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain("INVALID_MAX_TOKENS");
    }
  });

  it("複数違反を集約して返す", () => {
    const r = validateWritingRequest({
      mode: "general",
      prompt: "  ",
      maxTokens: -5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("未知モードを禁止 (UNSUPPORTED_MODE)", () => {
    const r = validateWritingRequest({ mode: "haiku", prompt: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain("UNSUPPORTED_MODE");
    }
  });
});

describe("normalizeWritingRequest", () => {
  it("未指定の maxTokens / temperature をモード別既定で補完する", () => {
    const def = resolveWritingMode("business");
    const n = normalizeWritingRequest({ mode: "business", prompt: "報告書" });
    expect(n.maxTokens).toBe(def.defaults.maxTokens);
    expect(n.temperature).toBe(def.defaults.temperature);
    expect(n.mode).toBe("business");
    expect(n.prompt).toBe("報告書");
  });

  it("指定値は既定で上書きしない", () => {
    const n = normalizeWritingRequest({
      mode: "general",
      prompt: "x",
      maxTokens: 256,
      temperature: 0.5,
    });
    expect(n.maxTokens).toBe(256);
    expect(n.temperature).toBe(0.5);
  });
});
