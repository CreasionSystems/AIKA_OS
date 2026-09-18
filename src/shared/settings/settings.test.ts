import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  SettingsValidationError,
  SettingsService,
  SettingsUnavailableError,
  SettingsRecoveryRequiredError,
  mergeWithDefaults,
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
    expect(DEFAULT_SETTINGS.mediaPollIntervalMs).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.language).toBe("system");
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

  it("範囲外 / 非整数の mediaPollIntervalMs を拒否する", () => {
    expect(validateSettings({ mediaPollIntervalMs: 50 }).ok).toBe(false); // 下限未満
    expect(validateSettings({ mediaPollIntervalMs: 100000 }).ok).toBe(false); // 上限超過
    expect(validateSettings({ mediaPollIntervalMs: 250.5 }).ok).toBe(false); // 非整数
    const r = validateSettings({ mediaPollIntervalMs: 0 });
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain(
        "INVALID_POLL_INTERVAL",
      );
    }
  });

  it("範囲内の mediaPollIntervalMs を受理する", () => {
    expect(validateSettings({ mediaPollIntervalMs: 1000 }).ok).toBe(true);
  });

  it("不正な language を拒否する", () => {
    const r = validateSettings({ language: "de" } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.map((v) => v.code)).toContain("INVALID_LANGUAGE");
    }
  });

  it("有効な language (system/ja/en) を受理する", () => {
    expect(validateSettings({ language: "system" }).ok).toBe(true);
    expect(validateSettings({ language: "ja" }).ok).toBe(true);
    expect(validateSettings({ language: "en" }).ok).toBe(true);
  });

  it("追加言語 (ko/zh-Hans/zh-Hant/fr) を受理する", () => {
    expect(validateSettings({ language: "ko" }).ok).toBe(true);
    expect(validateSettings({ language: "zh-Hans" }).ok).toBe(true);
    expect(validateSettings({ language: "zh-Hant" }).ok).toBe(true);
    expect(validateSettings({ language: "fr" }).ok).toBe(true);
  });
});

describe("SettingsService.load", () => {
  it("空ストアでは ready で既定値を返す (初回起動)", async () => {
    const svc = new SettingsService(new FakeSettingsStore());
    expect(await svc.load()).toEqual({
      status: "ready",
      settings: DEFAULT_SETTINGS,
    });
  });

  it("永続値を既定にマージして返す", async () => {
    const store = new FakeSettingsStore({ theme: "dark" });
    const svc = new SettingsService(store);
    const res = await svc.load();
    // 欠落キーの補完は前方互換であり異常ではないので ready。
    expect(res.status).toBe("ready");
    if (res.status === "unavailable") return;
    expect(res.settings.theme).toBe("dark");
    expect(res.settings.defaultWritingMode).toBe(
      DEFAULT_SETTINGS.defaultWritingMode,
    );
  });

  it("不正な永続値はその項目だけ既定へフォールバックする", async () => {
    const store = new FakeSettingsStore({
      theme: "dark",
      jobHistoryLimit: -5,
      mediaPollIntervalMs: 5,
      language: "de",
    });
    const svc = new SettingsService(store);
    const res = await svc.load();
    // 値が壊れていた項目があるので recovered。
    expect(res.status).toBe("recovered");
    if (res.status !== "recovered") return;
    expect(res.settings.theme).toBe("dark");
    expect(res.settings.jobHistoryLimit).toBe(DEFAULT_SETTINGS.jobHistoryLimit);
    expect(res.settings.mediaPollIntervalMs).toBe(
      DEFAULT_SETTINGS.mediaPollIntervalMs,
    );
    expect(res.settings.language).toBe(DEFAULT_SETTINGS.language);
    expect(res.issues.map((i) => i.key).sort()).toEqual([
      "jobHistoryLimit",
      "language",
      "mediaPollIntervalMs",
    ]);
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
    expect(reloaded.status).toBe("ready");
    if (reloaded.status === "unavailable") return;
    expect(reloaded.settings.theme).toBe("light");
    expect(reloaded.settings.jobHistoryLimit).toBe(20);
  });

  it("不正値は SettingsValidationError で拒否し、書込まない", async () => {
    const store = new FakeSettingsStore();
    const svc = new SettingsService(store);

    await expect(
      svc.save({ theme: "neon" } as unknown as Partial<AppSettings>),
    ).rejects.toBeInstanceOf(SettingsValidationError);
    // 何も書き込まれていない (ファイル未作成と同じ状態のまま)
    expect(await store.read()).toEqual({ status: "missing" });
  });
});

/**
 * フォールバックの報告 (#32)。
 *
 * 「何を既定値へ落としたか」を知っているのはこの関数だけ。AppSettings だけを
 * 返していたため、初回起動・互換補完・値の破損が区別できなかった。
 */
describe("mergeWithDefaults: フォールバックの報告", () => {
  it("全キーが有効なら fallback は無い", () => {
    const { settings, fallbacks } = mergeWithDefaults({ ...DEFAULT_SETTINGS });
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(fallbacks).toEqual([]);
  });

  it("キー欠落は missing (前方互換であって異常ではない)", () => {
    const { settings, fallbacks } = mergeWithDefaults({ theme: "dark" });
    expect(settings.theme).toBe("dark");
    expect(fallbacks.every((f) => f.reason === "missing")).toBe(true);
    expect(fallbacks.map((f) => f.key).sort()).toEqual([
      "defaultWritingMode",
      "jobHistoryLimit",
      "language",
      "mediaPollIntervalMs",
    ]);
  });

  it("値が壊れていれば invalid", () => {
    const { settings, fallbacks } = mergeWithDefaults({
      ...DEFAULT_SETTINGS,
      theme: "neon",
      jobHistoryLimit: -5,
    });
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(fallbacks).toEqual([
      { key: "theme", reason: "invalid" },
      { key: "jobHistoryLimit", reason: "invalid" },
    ]);
  });

  it("欠落と不正が混在しても種別ごとに分かれる", () => {
    const { fallbacks } = mergeWithDefaults({ theme: "neon" });
    expect(fallbacks.find((f) => f.key === "theme")?.reason).toBe("invalid");
    expect(fallbacks.find((f) => f.key === "language")?.reason).toBe("missing");
  });

  it("範囲外・型不正も invalid として報告する", () => {
    const { fallbacks } = mergeWithDefaults({
      ...DEFAULT_SETTINGS,
      mediaPollIntervalMs: 5,
      language: "de",
      defaultWritingMode: 42,
    });
    expect(fallbacks.map((f) => f.key).sort()).toEqual([
      "defaultWritingMode",
      "language",
      "mediaPollIntervalMs",
    ]);
    expect(fallbacks.every((f) => f.reason === "invalid")).toBe(true);
  });
});

/**
 * 読み取り結果からの写像 (#31 / #32)。
 * 初回起動・互換補完は ready、値の破損だけを recovered として区別する。
 */
describe("SettingsService.load: 状態の写像", () => {
  it("読めなければ unavailable を返し、例外にしない", async () => {
    const svc = new SettingsService(new FakeSettingsStore(null, "malformed"));
    expect(await svc.load()).toEqual({
      status: "unavailable",
      failure: "malformed",
    });
  });

  it("失敗理由をそのまま伝える", async () => {
    const svc = new SettingsService(new FakeSettingsStore(null, "permission"));
    const res = await svc.load();
    expect(res.status).toBe("unavailable");
    if (res.status !== "unavailable") return;
    expect(res.failure).toBe("permission");
  });

  it("欠落キーだけなら ready (利用者に通知しない)", async () => {
    const svc = new SettingsService(new FakeSettingsStore({ theme: "dark" }));
    const res = await svc.load();
    expect(res.status).toBe("ready");
  });

  it("不正値があれば recovered で該当項目だけを報告する", async () => {
    const svc = new SettingsService(
      new FakeSettingsStore({ ...DEFAULT_SETTINGS, theme: "neon" }),
    );
    const res = await svc.load();
    expect(res.status).toBe("recovered");
    if (res.status !== "recovered") return;
    expect(res.issues).toEqual([{ key: "theme", reason: "invalid" }]);
    expect(res.settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });
});

/**
 * 読めない設定の保護 (#31 / #32)。
 * 読めていない内容を既定値で上書きしないよう、save を中断する。
 */
describe("SettingsService.save: 読めない設定の上に書かない", () => {
  it("読み取り不能なら SettingsUnavailableError を投げ、書込まない", async () => {
    const store = new FakeSettingsStore(null, "malformed");
    const writes: AppSettings[] = [];
    const guarded = {
      read: () => store.read(),
      write: async (s: AppSettings) => {
        writes.push(s);
      },
    };
    const svc = new SettingsService(guarded);

    await expect(svc.save({ theme: "dark" })).rejects.toBeInstanceOf(
      SettingsUnavailableError,
    );
    expect(writes).toEqual([]);
  });

  // 保護は UI の文言ではなく service 側で強制する。
  it("recovered の保存は明示の復旧なしでは通らない", async () => {
    const store = new FakeSettingsStore({ ...DEFAULT_SETTINGS, theme: "neon" });
    await expect(
      new SettingsService(store).save({ theme: "dark" }),
    ).rejects.toBeInstanceOf(SettingsRecoveryRequiredError);
  });
});

/**
 * 既定値での上書き保護 (#32)。
 *
 * 保護の本体は service 側。renderer の文言や申告ではなく、保存時に読み直した
 * 状態で判定する。
 */
describe("SettingsService.save: 既定値での上書きには明示の復旧が要る", () => {
  /** 書込みを記録するストア。 */
  function recordingStore(initial: Record<string, unknown> | null) {
    const store = new FakeSettingsStore(initial);
    const writes: AppSettings[] = [];
    return {
      writes,
      store: {
        read: () => store.read(),
        write: async (s: AppSettings) => {
          writes.push(s);
          await store.write(s);
        },
      },
    };
  }

  const BROKEN = { ...DEFAULT_SETTINGS, theme: "neon" };

  it("recovered で intent 省略なら書込まず SettingsRecoveryRequiredError", async () => {
    const { store, writes } = recordingStore(BROKEN);
    await expect(
      new SettingsService(store).save({ theme: "dark" }),
    ).rejects.toBeInstanceOf(SettingsRecoveryRequiredError);
    expect(writes).toEqual([]);
  });

  it('recovered で "normal" を明示しても書込まない', async () => {
    const { store, writes } = recordingStore(BROKEN);
    await expect(
      new SettingsService(store).save({ theme: "dark" }, "normal"),
    ).rejects.toBeInstanceOf(SettingsRecoveryRequiredError);
    expect(writes).toEqual([]);
  });

  it("エラーは既定値へ落ちた項目を持つ", async () => {
    const { store } = recordingStore(BROKEN);
    await expect(
      new SettingsService(store).save({ theme: "dark" }),
    ).rejects.toMatchObject({ issues: [{ key: "theme", reason: "invalid" }] });
  });

  it('recovered でも "restore-defaults" なら上書きできる', async () => {
    const { store, writes } = recordingStore(BROKEN);
    const saved = await new SettingsService(store).save(
      { theme: "dark" },
      "restore-defaults",
    );
    expect(saved.theme).toBe("dark");
    expect(writes).toHaveLength(1);
  });

  it("ready の保存は従来どおり追加操作なしで成功する", async () => {
    const { store, writes } = recordingStore({ ...DEFAULT_SETTINGS });
    const saved = await new SettingsService(store).save({ theme: "dark" });
    expect(saved.theme).toBe("dark");
    expect(writes).toHaveLength(1);
  });

  it("unavailable は intent に関係なく書込まない", async () => {
    const base = new FakeSettingsStore(null, "malformed");
    const writes: AppSettings[] = [];
    const store = {
      read: () => base.read(),
      write: async (s: AppSettings) => {
        writes.push(s);
      },
    };
    for (const intent of ["normal", "restore-defaults"] as const) {
      await expect(
        new SettingsService(store).save({ theme: "dark" }, intent),
      ).rejects.toBeInstanceOf(SettingsUnavailableError);
    }
    expect(writes).toEqual([]);
  });
});
