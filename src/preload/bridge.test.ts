import { describe, it, expect, vi } from "vitest";
import {
  createAikaApi,
  exposeAikaApi,
  AIKA_API_KEY,
  type ContextBridgeLike,
} from "./bridge";
import { getAikaApi } from "./windowApi";
import { IPC_CHANNELS } from "@shared/ipc/contract";

/**
 * preload の型付き IPC 契約テスト。
 *
 * 固定する契約:
 *  - renderer に公開する API は generateText / submitImageJob /
 *    submitVideoJob / getJob の4つだけ。
 *  - 汎用 ipcRenderer や channel 名を露出しない。
 *  - 各メソッドは内部 channel で invoke へ委譲し、結果を素通しする。
 *  - contextBridge には単一キー "aika" でのみ公開する。
 */

function makeInvokeSpy() {
  const calls: { channel: string; args: unknown[] }[] = [];
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    calls.push({ channel, args });
    return "RESULT";
  });
  return { invoke, calls };
}

describe("createAikaApi: 公開面の最小性", () => {
  it("公開メソッドは4つだけ", () => {
    const { invoke } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    expect(Object.keys(api).sort()).toEqual(
      [
        "generateText",
        "getJob",
        "getSettings",
        "saveSettings",
        "submitImageJob",
        "submitVideoJob",
        "checkUpdate",
      ].sort(),
    );
  });

  it("汎用 ipcRenderer / send / on / invoke を露出しない", () => {
    const { invoke } = makeInvokeSpy();
    const api = createAikaApi(invoke) as unknown as Record<string, unknown>;
    expect(api.ipcRenderer).toBeUndefined();
    expect(api.send).toBeUndefined();
    expect(api.on).toBeUndefined();
    expect(api.invoke).toBeUndefined();
  });

  it("公開値はすべて関数 (channel 名などのデータを漏らさない)", () => {
    const { invoke } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    expect(Object.values(api).every((v) => typeof v === "function")).toBe(true);
  });
});

describe("createAikaApi: channel への委譲と素通し", () => {
  it("generateText は内部 channel へ委譲し結果を返す", async () => {
    const { invoke, calls } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    const req = { mode: "general", prompt: "x" };
    const res = await api.generateText(req);
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.generateText);
    expect(calls[0]?.args).toEqual([req]);
    expect(res).toBe("RESULT");
  });

  it("submitImageJob は内部 channel へ委譲する", async () => {
    const { invoke, calls } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    await api.submitImageJob({ prompt: "a cat" });
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.submitImageJob);
  });

  it("submitVideoJob は内部 channel へ委譲する", async () => {
    const { invoke, calls } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    await api.submitVideoJob({ kind: "t2v", prompt: "a dog" });
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.submitVideoJob);
  });

  it("getJob は id を引数に内部 channel へ委譲する", async () => {
    const { invoke, calls } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    await api.getJob("job-1");
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.getJob);
    expect(calls[0]?.args).toEqual(["job-1"]);
  });

  it("getSettings は引数なしで内部 channel へ委譲する", async () => {
    const { invoke, calls } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    await api.getSettings();
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.getSettings);
    expect(calls[0]?.args).toEqual([]);
  });

  it("saveSettings は patch を引数に内部 channel へ委譲する", async () => {
    const { invoke, calls } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    await api.saveSettings({ theme: "dark" });
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.saveSettings);
    expect(calls[0]?.args).toEqual([{ theme: "dark" }]);
  });

  it("checkUpdate は引数なしで内部 channel へ委譲する", async () => {
    const { invoke, calls } = makeInvokeSpy();
    const api = createAikaApi(invoke);
    await api.checkUpdate();
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.checkUpdate);
    expect(calls[0]?.args).toEqual([]);
  });
});

describe("exposeAikaApi: contextBridge への最小公開", () => {
  it('単一キー "aika" にのみ AikaApi を公開する', () => {
    const exposed: { key: string; api: unknown }[] = [];
    const bridge: ContextBridgeLike = {
      exposeInMainWorld: (key, api) => exposed.push({ key, api }),
    };
    const { invoke } = makeInvokeSpy();

    exposeAikaApi(bridge, invoke);

    expect(exposed).toHaveLength(1);
    expect(exposed[0]?.key).toBe(AIKA_API_KEY);
    expect(AIKA_API_KEY).toBe("aika");
    expect(Object.keys(exposed[0]?.api as object).sort()).toEqual(
      [
        "generateText",
        "getJob",
        "getSettings",
        "saveSettings",
        "submitImageJob",
        "submitVideoJob",
        "checkUpdate",
      ].sort(),
    );
  });
});

describe("window 型アクセサ", () => {
  it("getAikaApi は関数として存在する (型は typecheck で検証)", () => {
    expect(typeof getAikaApi).toBe("function");
  });
});
