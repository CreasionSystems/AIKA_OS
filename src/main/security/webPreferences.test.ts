import { describe, it, expect } from "vitest";
import {
  createSecureWebPreferences,
  assertSecureWebPreferences,
} from "./webPreferences";

/**
 * Electron 権限境界の不変条件を「契約」として固定するテスト。
 *
 * 方針 (handover):
 *  - contextIsolation: true
 *  - nodeIntegration: false
 *  - preload + contextBridge で最小限 API を公開する
 *
 * renderer を信用せず、main / preload / renderer の境界を明確にする。
 * このテストが緑である限り、後続実装が安全構成を崩しても回帰として検知できる。
 */
describe("createSecureWebPreferences", () => {
  it("renderer を隔離する (contextIsolation = true)", () => {
    expect(createSecureWebPreferences().contextIsolation).toBe(true);
  });

  it("renderer に Node を露出しない (nodeIntegration = false)", () => {
    expect(createSecureWebPreferences().nodeIntegration).toBe(false);
  });

  it("デフォルト方針として sandbox を有効化する (上書き可)", () => {
    // sandbox はハード必須ではなく安全デフォルト (方針レベル)。
    expect(createSecureWebPreferences().sandbox).toBe(true);
  });

  it("sandbox は明示的に無効化できる (方針の上書き)", () => {
    expect(createSecureWebPreferences({ sandbox: false }).sandbox).toBe(false);
  });

  it("preload スクリプトの絶対パスを要求する", () => {
    const preloadPath = "/abs/path/preload.js";
    const prefs = createSecureWebPreferences({ preloadPath });
    expect(prefs.preload).toBe(preloadPath);
  });

  it("旧来の危険なリモートモジュールを有効化しない", () => {
    const prefs = createSecureWebPreferences();
    // @ts-expect-error enableRemoteModule は型に存在させないが、誤って真値が混入しないことを保証
    expect(prefs.enableRemoteModule).toBeUndefined();
  });
});

describe("assertSecureWebPreferences", () => {
  it("安全な設定を受理する", () => {
    expect(() =>
      assertSecureWebPreferences({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: "/abs/path/preload.js",
      }),
    ).not.toThrow();
  });

  it("contextIsolation が false の設定を拒否する", () => {
    expect(() =>
      assertSecureWebPreferences({
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: true,
        preload: "/abs/path/preload.js",
      }),
    ).toThrow(/contextIsolation/);
  });

  it("nodeIntegration が true の設定を拒否する", () => {
    expect(() =>
      assertSecureWebPreferences({
        contextIsolation: true,
        nodeIntegration: true,
        sandbox: true,
        preload: "/abs/path/preload.js",
      }),
    ).toThrow(/nodeIntegration/);
  });

  it("sandbox が false でも拒否しない (方針レベルのため強制しない)", () => {
    expect(() =>
      assertSecureWebPreferences({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: "/abs/path/preload.js",
      }),
    ).not.toThrow();
  });

  it("preload が未指定/相対パスの設定を拒否する", () => {
    expect(() =>
      assertSecureWebPreferences({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: "relative/preload.js",
      }),
    ).toThrow(/preload/);
  });
});
