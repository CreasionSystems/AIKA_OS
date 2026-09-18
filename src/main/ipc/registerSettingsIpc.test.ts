import { describe, it, expect, vi } from "vitest";
import { registerSettingsIpc } from "./registerSettingsIpc";
import type { IpcMainLike } from "./registerInferenceIpc";
import {
  SettingsService,
  SettingsValidationError,
  DEFAULT_SETTINGS,
} from "@shared/settings/settings";
import type { SettingsIpcService } from "./registerSettingsIpc";
import { FakeSettingsStore } from "@shared/settings/fakeSettingsStore";
import { createAikaApi, type IpcInvoke } from "@preload/bridge";
import { IPC_CHANNELS } from "@shared/ipc/contract";

/**
 * 設定 IPC ハンドラ契約テスト。preload (getSettings/saveSettings) と対になる。
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

function makeFakeIpc() {
  const handlers = new Map<string, Handler>();
  const ipcMain: IpcMainLike = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  const invoke: IpcInvoke = async (channel, ...args) => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler: ${channel}`);
    return h({}, ...args);
  };
  return { ipcMain, invoke, handlers };
}

describe("registerSettingsIpc", () => {
  it("2チャンネルを handle する", () => {
    const { ipcMain, handlers } = makeFakeIpc();
    registerSettingsIpc(ipcMain, new SettingsService(new FakeSettingsStore()));
    expect([...handlers.keys()].sort()).toEqual(
      [IPC_CHANNELS.getSettings, IPC_CHANNELS.saveSettings].sort(),
    );
  });

  it("getSettings は既定値を返し、saveSettings 後に反映される (往復)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const store = new FakeSettingsStore();
    registerSettingsIpc(ipcMain, new SettingsService(store));
    const api = createAikaApi(invoke);

    expect(await api.getSettings()).toEqual({
      status: "ready",
      settings: DEFAULT_SETTINGS,
    });

    const saved = await api.saveSettings({ theme: "dark" });
    expect(saved.status).toBe("succeeded");
    if (saved.status !== "succeeded") return;
    expect(saved.result.theme).toBe("dark");
    const reloaded = await api.getSettings();
    expect(reloaded.status).toBe("ready");
    if (reloaded.status === "unavailable") return;
    expect(reloaded.settings.theme).toBe("dark");
  });

  it("save は service へ委譲する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const service = new SettingsService(new FakeSettingsStore());
    const spy = vi.spyOn(service, "save");
    registerSettingsIpc(ipcMain, service);
    const api = createAikaApi(invoke);

    await api.saveSettings({ jobHistoryLimit: 5 });
    // intent 省略は normal として委譲する。
    expect(spy).toHaveBeenCalledWith({ jobHistoryLimit: 5 }, "normal");
  });
});

/**
 * save の失敗を IPC 境界で結果ユニオンへ変換する。
 *
 * Electron の invoke は reject 値を name / message / stack だけの Error に
 * 作り直すため、throw では violations が renderer に届かない。明細が越えるのは
 * resolve 経路だけなので、handler が値へ変換する。
 */
describe("saveSettings: IPC 境界での結果ユニオン化", () => {
  /** save だけを差し替えた最小サービス。 */
  function serviceWith(save: SettingsIpcService["save"]): SettingsIpcService {
    return {
      load: async () => ({ status: "ready", settings: DEFAULT_SETTINGS }),
      save,
    };
  }

  const VIOLATIONS = [
    {
      code: "INVALID_JOB_HISTORY_LIMIT" as const,
      messageKey: "settings.validation.invalidJobHistoryLimit",
    },
    {
      code: "INVALID_POLL_INTERVAL" as const,
      messageKey: "settings.validation.invalidPollInterval",
      messageParams: { min: 100, max: 60000 },
    },
  ];

  it("SettingsValidationError は reject せず invalid を resolve する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      serviceWith(async () => {
        throw new SettingsValidationError([...VIOLATIONS]);
      }),
    );
    await expect(
      invoke(IPC_CHANNELS.saveSettings, { jobHistoryLimit: NaN }),
    ).resolves.toMatchObject({ status: "invalid" });
  });

  it("issues の code / messageKey / messageParams が保持される", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      serviceWith(async () => {
        throw new SettingsValidationError([...VIOLATIONS]);
      }),
    );
    const res = (await invoke(IPC_CHANNELS.saveSettings, {})) as {
      status: string;
      issues: readonly Record<string, unknown>[];
    };

    expect(res.issues).toEqual(VIOLATIONS);
    expect(res.issues.map((i) => i.code)).toEqual([
      "INVALID_JOB_HISTORY_LIMIT",
      "INVALID_POLL_INTERVAL",
    ]);
    // 補間値も落ちない。
    expect(res.issues[1]?.messageParams).toEqual({ min: 100, max: 60000 });
  });

  it("予期しない例外は failed になり、内部情報を含まない", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      serviceWith(async () => {
        throw new Error("EACCES: permission denied, open '/Users/secret/settings.json'");
      }),
    );
    const res = (await invoke(IPC_CHANNELS.saveSettings, {})) as Record<
      string,
      unknown
    >;

    expect(res.status).toBe("failed");
    expect(res.messageKey).toBe("settings.error.saveFailed");

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("EACCES");
    expect(serialized).not.toContain("/Users/secret");
    expect(serialized).not.toContain("aika:settings:");
    expect(serialized).not.toContain("Error invoking remote method");
    expect(Object.keys(res).sort()).toEqual(["messageKey", "status"]);
  });

  it("失敗しても reject しない (renderer が生の Error を受け取らない)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      serviceWith(async () => {
        throw new Error("boom");
      }),
    );
    await expect(
      invoke(IPC_CHANNELS.saveSettings, {}),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("成功は succeeded として更新後の設定を包んで返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(ipcMain, new SettingsService(new FakeSettingsStore()));
    const res = await invoke(IPC_CHANNELS.saveSettings, { theme: "dark" });
    expect(res).toMatchObject({
      status: "succeeded",
      result: { theme: "dark" },
    });
  });

  it("実サービス経由でも不正値は invalid になり、書込まれない", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const store = new FakeSettingsStore();
    registerSettingsIpc(ipcMain, new SettingsService(store));

    // UI で数値欄を空にすると valueAsNumber が NaN になる経路。
    const res = (await invoke(IPC_CHANNELS.saveSettings, {
      jobHistoryLimit: NaN,
    })) as { status: string; issues: readonly { code: string }[] };

    expect(res.status).toBe("invalid");
    expect(res.issues[0]?.code).toBe("INVALID_JOB_HISTORY_LIMIT");
    // 既定のまま (書込まれていない)。
    expect(await new SettingsService(store).load()).toEqual({
      status: "ready",
      settings: DEFAULT_SETTINGS,
    });
  });
});

/**
 * getSettings は読み取り失敗でも reject しない (#31)。
 *
 * reject すると main の起動処理や renderer の初期化が未処理の reject で
 * 止まり、ウィンドウが開かないまま固まる。
 */
describe("getSettings: 読み取り失敗を値で返す", () => {
  it("読めなくても reject せず unavailable を resolve する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(new FakeSettingsStore(null, "permission")),
    );
    await expect(invoke(IPC_CHANNELS.getSettings)).resolves.toEqual({
      status: "unavailable",
      failure: "permission",
    });
  });

  it("unavailable に内部パス・stack・channel 名を含まない", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(new FakeSettingsStore(null, "malformed")),
    );
    const res = (await invoke(IPC_CHANNELS.getSettings)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(res).sort()).toEqual(["failure", "status"]);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("aika:settings:");
    expect(serialized).not.toContain("Error invoking remote method");
    expect(serialized).not.toContain("/");
  });

  it("不正値があれば recovered を明細つきで返す", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(
        new FakeSettingsStore({ ...DEFAULT_SETTINGS, theme: "neon" }),
      ),
    );
    expect(await invoke(IPC_CHANNELS.getSettings)).toMatchObject({
      status: "recovered",
      issues: [{ key: "theme", reason: "invalid" }],
    });
  });

  it("結果は structured clone を通る (plain data のみ)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(
        new FakeSettingsStore({ ...DEFAULT_SETTINGS, theme: "neon" }),
      ),
    );
    const res = await invoke(IPC_CHANNELS.getSettings);
    expect(structuredClone(res)).toEqual(res);
  });

  it("読めない設定の上には保存せず failed を返す (上書きしない)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(new FakeSettingsStore(null, "malformed")),
    );
    await expect(
      invoke(IPC_CHANNELS.saveSettings, { theme: "dark" }),
    ).resolves.toMatchObject({ status: "failed" });
  });
});

/**
 * 既定値での上書き保護を IPC 境界で強制する (#32)。
 *
 * renderer のボタン文言だけに依存すると、window.aika.saveSettings を直接
 * 呼ばれた時に無言で上書きできてしまう。判定は main が読み直して行う。
 */
describe("saveSettings: 既定値での上書きには明示の復旧が要る", () => {
  const BROKEN = { ...DEFAULT_SETTINGS, theme: "neon" };

  it("intent なしの直呼びは failed になり、書込まない", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const store = new FakeSettingsStore(BROKEN);
    registerSettingsIpc(ipcMain, new SettingsService(store));

    const res = (await invoke(IPC_CHANNELS.saveSettings, {
      theme: "dark",
    })) as Record<string, unknown>;

    expect(res.status).toBe("failed");
    expect(res.messageKey).toBe("settings.error.recoveryRequired");
    // 壊れた値がそのまま残っている (上書きされていない)。
    const raw = await store.read();
    expect(raw).toMatchObject({ status: "loaded", raw: { theme: "neon" } });
  });

  it('"normal" を明示した直呼びも failed になる', async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(new FakeSettingsStore(BROKEN)),
    );
    await expect(
      invoke(IPC_CHANNELS.saveSettings, { theme: "dark" }, "normal"),
    ).resolves.toMatchObject({
      status: "failed",
      messageKey: "settings.error.recoveryRequired",
    });
  });

  it("未知の intent 文字列は normal として扱う (昇格させない)", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(new FakeSettingsStore(BROKEN)),
    );
    await expect(
      invoke(IPC_CHANNELS.saveSettings, { theme: "dark" }, "anything-else"),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it('"restore-defaults" なら succeeded になり書込まれる', async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    const store = new FakeSettingsStore(BROKEN);
    registerSettingsIpc(ipcMain, new SettingsService(store));

    await expect(
      invoke(
        IPC_CHANNELS.saveSettings,
        { theme: "dark" },
        "restore-defaults",
      ),
    ).resolves.toMatchObject({ status: "succeeded", result: { theme: "dark" } });
    expect(await store.read()).toMatchObject({
      status: "loaded",
      raw: { theme: "dark" },
    });
  });

  it("ready の保存は intent なしで従来どおり成功する", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(new FakeSettingsStore({ ...DEFAULT_SETTINGS })),
    );
    await expect(
      invoke(IPC_CHANNELS.saveSettings, { theme: "dark" }),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("failed に内部情報を含まない", async () => {
    const { ipcMain, invoke } = makeFakeIpc();
    registerSettingsIpc(
      ipcMain,
      new SettingsService(new FakeSettingsStore(BROKEN)),
    );
    const res = (await invoke(IPC_CHANNELS.saveSettings, {})) as Record<
      string,
      unknown
    >;
    expect(Object.keys(res).sort()).toEqual(["messageKey", "status"]);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("SettingsRecoveryRequiredError");
    expect(serialized).not.toContain("aika:settings:");
    expect(serialized).not.toContain("/");
  });
});

/**
 * 書込み失敗は既存の failed / saveFailed に収束させる (#33)。
 * atomic write は Node の例外をそのまま投げるので、パスや code が renderer に
 * 漏れないことを境界で固定する。
 */
describe("saveSettings: 書込み失敗を内部情報なしで返す", () => {
  function failingWriteStore(code: string) {
    const base = new FakeSettingsStore({ ...DEFAULT_SETTINGS });
    return {
      read: () => base.read(),
      write: async () => {
        const err: NodeJS.ErrnoException = new Error(
          `${code}: operation failed, rename '/Users/secret/Library/Application Support/aika/settings.json.123-abc.tmp' -> '/Users/secret/Library/Application Support/aika/settings.json'`,
        );
        err.code = code;
        throw err;
      },
    };
  }

  it.each(["EACCES", "ENOSPC", "EPERM", "EXDEV", "EIO"])(
    "%s は failed / saveFailed になり、パスも code も含まない",
    async (code) => {
      const { ipcMain, invoke } = makeFakeIpc();
      registerSettingsIpc(
        ipcMain,
        new SettingsService(failingWriteStore(code)),
      );
      const res = (await invoke(IPC_CHANNELS.saveSettings, {
        theme: "dark",
      })) as Record<string, unknown>;

      expect(res).toEqual({
        status: "failed",
        messageKey: "settings.error.saveFailed",
      });
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain("/Users/secret");
      expect(serialized).not.toContain(".tmp");
    },
  );
});
