import { describe, it, expect } from "vitest";
import {
  UpdateManager,
  FakeUpdateChecker,
  type UpdateChecker,
  type UpdateInfo,
} from "./updateManager";

/**
 * UpdateManager 最小版 (確認のみ) の状態機械テスト。
 *
 * 固定する契約:
 *  - idle -> checking -> available / up-to-date / error
 *  - available は更新情報を保持する
 *  - 確認中の二重 check はガードで throw
 *  - 確認後は再 check 可能
 */

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("初期状態", () => {
  it("phase は idle", () => {
    const mgr = new UpdateManager(new FakeUpdateChecker(null));
    expect(mgr.getState().phase).toBe("idle");
  });
});

describe("check の結果遷移", () => {
  it("更新ありなら available + 更新情報", async () => {
    const info: UpdateInfo = { version: "1.2.0", notes: "fixes" };
    const mgr = new UpdateManager(new FakeUpdateChecker(info));
    const state = await mgr.check();
    expect(state.phase).toBe("available");
    expect(state.info).toEqual(info);
  });

  it("更新なしなら up-to-date", async () => {
    const mgr = new UpdateManager(new FakeUpdateChecker(null));
    const state = await mgr.check();
    expect(state.phase).toBe("up-to-date");
  });

  it("チェッカが throw すると error + メッセージ", async () => {
    const checker: UpdateChecker = {
      check: async () => {
        throw new Error("network down");
      },
    };
    const mgr = new UpdateManager(checker);
    const state = await mgr.check();
    expect(state.phase).toBe("error");
    expect(state.error).toContain("network down");
  });
});

describe("checking 状態と二重実行ガード", () => {
  it("check 中は phase checking で、二重 check は throw", async () => {
    const d = makeDeferred<UpdateInfo | null>();
    const checker: UpdateChecker = { check: () => d.promise };
    const mgr = new UpdateManager(checker);

    const inflight = mgr.check();
    expect(mgr.getState().phase).toBe("checking");
    await expect(mgr.check()).rejects.toThrow(/確認中/);

    d.resolve(null);
    await inflight;
    expect(mgr.getState().phase).toBe("up-to-date");
  });
});

describe("再確認", () => {
  it("up-to-date の後に再 check できる", async () => {
    const mgr = new UpdateManager(new FakeUpdateChecker(null));
    await mgr.check();
    expect(mgr.getState().phase).toBe("up-to-date");
    const again = await mgr.check();
    expect(again.phase).toBe("up-to-date");
  });
});
