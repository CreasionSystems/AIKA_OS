import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  SettingsValidationError,
  SettingsService,
  type AppSettings,
} from "./settings";
import { FakeSettingsStore } from "./fakeSettingsStore";

/**
 * 設定ドメイン + 永続化抽象の契約テスト (純ロジック)。
 *
 * 固定する契約:
 *  - 既定値 (DEFAULT_SETTINGS)
 *  - 保存 / 読込 (SettingsStore 抽象越し)
 *  - バリデーション (項目単位の違反)
 *  - 不正な永続値は読込時に既定へフォールバック
 */

describe("DEFAULT_SETTINGS", () => {
  it("少数の既定値を持つ", () => {
    expect(DEFAULT_SETTINGS.defaultWritingMode).toBe("general");
    expect(DEFAULT_SETTINGS.theme).toBe("system");
    expect(DEFAULT_SETTINGS.jobHistoryLimit).toBeGreaterThan(0);
  });
});

describe("validateSettings", () => {
  it("正しい設定を受理する", () => {
    const r = validateSettings({
      defaultWritingMode: "novel",
      theme: "dark",
      jobHistoryLimit: 10,
    });
    expect(r.ok).toBe(true);
  });

  it("不正な theme を拒否する", () => {
    const r = validateSettings({ theme: "neon" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain("INVALID_THEME");
    }
  });

  it("不正な writing mode を拒否する", () => {
    const r = validateSettings({ defaultWritingMode: "haiku" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain(
        "INVALID_WRITING_MODE",
      );
    }
  });

  it("非整数 / 1未満の jobHistoryLimit を拒否する", () => {
    expect(validateSettings({ jobHistoryLimit: 0 }).ok).toBe(false);
    expect(validateSettings({ jobHistoryLimit: 2.5 }).ok).toBe(false);
  });
});

describe("SettingsService.load", () => {
  it("空ストアでは既定値を返す", async () => {
    const svc = new SettingsService(new FakeSettingsStore());
    expect(await svc.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("永続値を既定にマージして返す", async () => {
    const store = new FakeSettingsStore({ theme: "dark" });
    const svc = new SettingsService(store);
    const s = await svc.load();
    expect(s.theme).toBe("dark");
    expect(s.defaultWritingMode).toBe(DEFAULT_SETTINGS.defaultWritingMode);
  });

  it("不正な永続値はその項目だけ既定へフォールバックする", async () => {
    const store = new FakeSettingsStore({
      theme: "dark",
      jobHistoryLimit: -5,
    });
    const svc = new SettingsService(store);
    const s = await svc.load();
    expect(s.theme).toBe("dark");
    expect(s.jobHistoryLimit).toBe(DEFAULT_SETTINGS.jobHistoryLimit);
  });
});

describe("SettingsService.save", () => {
  it("検証 -> マージ -> 書込 し、再読込に反映される", async () => {
    const store = new FakeSettingsStore();
    const svc = new SettingsService(store);

    const saved = await svc.save({ theme: "light", jobHistoryLimit: 20 });
    expect(saved.theme).toBe("light");
    expect(saved.jobHistoryLimit).toBe(20);

    const reloaded = await new SettingsService(store).load();
    expect(reloaded.theme).toBe("light");
    expect(reloaded.jobHistoryLimit).toBe(20);
  });

  it("不正値は SettingsValidationError で拒否し、書込まない", async () => {
    const store = new FakeSettingsStore();
    const svc = new SettingsService(store);

    await expect(
      svc.save({ theme: "neon" } as unknown as Partial<AppSettings>),
    ).rejects.toBeInstanceOf(SettingsValidationError);
    // 何も書き込まれていない
    expect(await store.read()).toBeNull();
  });
});
